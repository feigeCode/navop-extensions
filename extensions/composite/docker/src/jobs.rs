//! Docker provider 的长任务(job)注册表。
//!
//! 镜像拉取等操作用时可长达数分钟,不能占用 provider 的单线程请求循环,
//! 也不能被宿主的一次 `resource/invoke` 超时截断。这里把它们放进 tokio
//! 任务并暴露标准 `job/*` 生命周期(启动/轮询/取消/取结果/释放)。
//!
//! 设计对齐 `elasticsearch-provider` 的 `state/job.rs`,但结果只支持内联
//! `ResultRef::Inline`(镜像拉取结果是摘要,不会超过 blob 阈值)。

use std::{collections::HashMap, future::Future, sync::Mutex};

use extension_protocol::{
    error::{ProtocolError, error_codes},
    job::{
        JobCancelParams, JobCloseParams, JobResultParams, JobResultResult, JobStartResult,
        JobState, JobStatusParams, JobStatusResult, ProgressPercent,
    },
    result_ref::ResultRef,
};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

/// 单个 provider 进程允许的并发任务上限。
const MAX_JOBS: usize = 32;

/// 一次 job 的完成通知:`Ok` 携带结果 JSON,`Err` 是失败原因文本。
type Completion = Result<Value, String>;

struct ProviderJob {
    state: JobState,
    progress_percent: Option<ProgressPercent>,
    message: Option<String>,
    result: Option<ResultRef>,
    completion: Option<mpsc::Receiver<Completion>>,
    cancellation: Option<oneshot::Sender<()>>,
}

impl Default for ProviderJob {
    fn default() -> Self {
        Self {
            state: JobState::Queued,
            progress_percent: None,
            message: None,
            result: None,
            completion: None,
            cancellation: None,
        }
    }
}

/// 线程安全的任务注册表(挂在 provider `State` 上)。
#[derive(Default)]
pub(crate) struct JobRegistry {
    jobs: Mutex<HashMap<String, ProviderJob>>,
}

impl JobRegistry {
    /// 启动一个任务:立即返回 job id,真正的执行在后台 tokio 任务里。
    pub(crate) fn start<F>(&self, future: F) -> Result<JobStartResult, Box<ProtocolError>>
    where
        F: Future<Output = Completion> + Send + 'static,
    {
        let mut jobs = lock(&self.jobs);
        if jobs.len() >= MAX_JOBS {
            return Err(boxed(
                error_codes::RESOURCE_BUSY,
                "Docker job limit reached",
            ));
        }
        let job_id = format!("docker-job-{}", Uuid::new_v4());
        let (completion_tx, completion_rx) = mpsc::channel(1);
        let (cancel_tx, cancel_rx) = oneshot::channel();
        tokio::spawn(async move {
            tokio::select! {
                result = future => {
                    let _ = completion_tx.send(result).await;
                }
                _ = cancel_rx => {}
            }
        });
        jobs.insert(
            job_id.clone(),
            ProviderJob {
                state: JobState::Running,
                message: Some("running".to_owned()),
                completion: Some(completion_rx),
                cancellation: Some(cancel_tx),
                ..ProviderJob::default()
            },
        );
        Ok(JobStartResult {
            job_id,
            state: JobState::Running,
        })
    }

    /// 尝试把后台任务的完成结果搬进 job 状态。
    ///
    /// 返回 `true` 表示状态发生了变化(用于判断是否需要广播事件)。
    pub(crate) fn poll(&self, job_id: &str) -> bool {
        let outcome = {
            let mut jobs = lock(&self.jobs);
            let Some(job) = jobs.get_mut(job_id) else {
                return false;
            };
            if job.state != JobState::Running {
                return false;
            }
            let Some(mut completion) = job.completion.take() else {
                job.state = JobState::Failed;
                job.message = Some("job worker is unavailable".to_owned());
                return true;
            };
            match completion.try_recv() {
                Ok(Ok(value)) => Some(Ok(value)),
                Ok(Err(message)) => Some(Err(message)),
                Err(mpsc::error::TryRecvError::Empty) => {
                    job.completion = Some(completion);
                    None
                }
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    Some(Err("job worker terminated".to_owned()))
                }
            }
        };

        let Some(outcome) = outcome else {
            return false;
        };
        let mut jobs = lock(&self.jobs);
        let Some(job) = jobs.get_mut(job_id) else {
            return false;
        };
        match outcome {
            Ok(value) => {
                job.state = JobState::Succeeded;
                job.progress_percent = ProgressPercent::new(100).ok();
                job.message = Some("completed".to_owned());
                job.result = Some(ResultRef::Inline { value });
                true
            }
            Err(message) => {
                job.state = JobState::Failed;
                job.progress_percent = None;
                job.message = Some(message);
                job.result = None;
                true
            }
        }
    }

    pub(crate) fn status(
        &self,
        params: JobStatusParams,
    ) -> Result<JobStatusResult, Box<ProtocolError>> {
        self.poll(&params.job_id);
        let jobs = lock(&self.jobs);
        let job = jobs.get(&params.job_id).ok_or_else(job_not_found)?;
        Ok(JobStatusResult {
            job_id: params.job_id,
            state: job.state,
            progress_percent: job.progress_percent,
            message: job.message.clone(),
        })
    }

    pub(crate) fn cancel(&self, params: JobCancelParams) -> Result<bool, Box<ProtocolError>> {
        let mut jobs = lock(&self.jobs);
        let job = jobs.get_mut(&params.job_id).ok_or_else(job_not_found)?;
        if job.state != JobState::Running {
            return Ok(false);
        }
        job.state = JobState::Cancelled;
        job.progress_percent = None;
        job.message = Some("cancelled".to_owned());
        job.result = None;
        job.completion = None;
        if let Some(cancel) = job.cancellation.take() {
            let _ = cancel.send(());
        }
        Ok(true)
    }

    pub(crate) fn result(
        &self,
        params: JobResultParams,
    ) -> Result<JobResultResult, Box<ProtocolError>> {
        self.poll(&params.job_id);
        let jobs = lock(&self.jobs);
        let job = jobs.get(&params.job_id).ok_or_else(job_not_found)?;
        match job.state {
            JobState::Succeeded => {}
            JobState::Running | JobState::Queued => {
                return Err(boxed(error_codes::RESOURCE_BUSY, "job result is not ready"));
            }
            JobState::Cancelled => {
                return Err(boxed(error_codes::REQUEST_CANCELLED, "job was cancelled"));
            }
            JobState::Failed => {
                return Err(boxed(
                    error_codes::INTERNAL_ERROR,
                    job.message
                        .clone()
                        .unwrap_or_else(|| "job failed".to_owned()),
                ));
            }
        }
        job.result
            .clone()
            .map(|result| JobResultResult { result })
            .ok_or_else(|| boxed(error_codes::INTERNAL_ERROR, "job result is unavailable"))
    }

    pub(crate) fn close(&self, params: JobCloseParams) {
        let mut jobs = lock(&self.jobs);
        if let Some(mut job) = jobs.remove(&params.job_id)
            && job.state == JobState::Running
            && let Some(cancel) = job.cancellation.take()
        {
            let _ = cancel.send(());
        }
    }

    /// 资源关闭或 provider 退出时,取消并清空该资源名下的任务。
    pub(crate) fn clear(&self) {
        let mut jobs = lock(&self.jobs);
        for job in jobs.values_mut() {
            if job.state == JobState::Running
                && let Some(cancel) = job.cancellation.take()
            {
                let _ = cancel.send(());
            }
        }
        jobs.clear();
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn boxed(
    code: extension_protocol::error::ErrorCode,
    message: impl Into<String>,
) -> Box<ProtocolError> {
    Box::new(ProtocolError::new(code, message))
}

fn job_not_found() -> Box<ProtocolError> {
    boxed(error_codes::RESOURCE_CLOSED, "job is closed or unknown")
}
