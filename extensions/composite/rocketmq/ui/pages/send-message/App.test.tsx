import { expect, open, test } from "nsh/test";
import { hostHandlers } from "../../lib/test-host";

const TOPIC_INPUT = "id:topic";
const TAG_INPUT = "id:tag";
const KEY_INPUT = "id:key";
const BODY_INPUT = "id:body";

const BODY = '{"orderId":"A1001","amount":99.5}';

interface SendParams {
  topic: string;
  tag?: string;
  key?: string;
  body: number[];
}

let params: SendParams[] = [];
let sendFailure: string | null = null;
let messageId = "MSG-0001";

function reset(): void {
  params = [];
  sendFailure = null;
  messageId = "MSG-0001";
}

/** 方法名从 App.tsx 的 OPERATIONS 抄：sendMessage → middleware/message/send。 */
function handlers() {
  return hostHandlers({
    "middleware/message/send": (data) => {
      params.push(data as unknown as SendParams);
      if (sendFailure !== null) throw new Error(sendFailure);
      return { message_id: messageId, status: "SEND_OK" };
    },
  });
}

function openPage() {
  return open("./App.tsx", { width: 1280, height: 900, host: { handlers: handlers() } });
}

test("JSON 合法：即时提示与字节数", async () => {
  reset();
  const app = await openPage();

  await app.type(BODY_INPUT, BODY);
  await app.waitFor("text:JSON 合法");
  expect(app.texts()).toContain("33 B · UTF-8 编码");
  expect(app.texts()).toContain("将按原始文本发送（不会重新序列化）。");
});

test("JSON 不合法：提示不合法但仍按原文发送", async () => {
  reset();
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.type(BODY_INPUT, "{not json");
  await app.waitFor("text:JSON 不合法");
  expect(app.texts()).toContain("不是合法 JSON，仍会按原文发送。");

  await app.press("发送");
  await app.waitFor("text:发送成功：MSG-0001");
  expect(params.length).toBe(1);
  expect(params[0].body).toEqual(Array.from(new TextEncoder().encode("{not json")));
});

test("Topic 为空：不发请求，只提示先填 Topic", async () => {
  reset();
  const app = await openPage();

  await app.press("发送");
  await app.waitFor("text:请先填写 Topic。");
  expect(params.length).toBe(0);

  await app.type(TOPIC_INPUT, "order-topic");
  await app.press("发送");
  await app.waitFor("text:发送成功：MSG-0001");
  expect(params.length).toBe(1);
});

test("发送成功：带上 tag/key/字节体，结果与历史都有 messageId", async () => {
  reset();
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.type(TAG_INPUT, "  TAG_A  ");
  await app.type(KEY_INPUT, "ORDER-1");
  await app.type(BODY_INPUT, BODY);
  await app.press("发送");
  await app.waitFor("text:发送成功：MSG-0001");

  expect(params[0].topic).toBe("order-topic");
  expect(params[0].tag).toBe("TAG_A");
  expect(params[0].key).toBe("ORDER-1");
  expect(params[0].body).toEqual(Array.from(new TextEncoder().encode(BODY)));

  // 写操作走 resource.invoke，参数用单数 tag/key。
  const invoke = app.host
    .calls()
    .find((call) => call.name === "navop.resource.invoke");
  expect(invoke === undefined).toBe(false);
  const data = (invoke?.data ?? {}) as { handle?: string; method?: string };
  expect(data.handle).toBe("r-1");
  expect(data.method).toBe("middleware/message/send");

  expect(app.shows("text:成功")).toBe(true);
  expect(app.shows("text:MSG-0001")).toBe(true);
  expect(app.shows("text:还没有发送记录")).toBe(false);
});

test("发送失败：显示原因，历史记一条失败", async () => {
  reset();
  sendFailure = "broker 拒绝写入：queue 已满";
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.type(BODY_INPUT, BODY);
  await app.press("发送");
  await app.waitFor("text:发送失败：broker 拒绝写入：queue 已满");

  expect(app.shows("text:失败")).toBe(true);
  expect(params.length).toBe(1);
});

test("历史回填：点一条记录把 topic/tag/key/正文填回表单", async () => {
  reset();
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.type(TAG_INPUT, "TAG_A");
  await app.type(KEY_INPUT, "ORDER-1");
  await app.type(BODY_INPUT, BODY);
  await app.press("发送");
  await app.waitFor("text:发送成功：MSG-0001");

  await app.clear(TOPIC_INPUT);
  await app.type(TOPIC_INPUT, "other-topic");
  await app.clear(BODY_INPUT);
  await app.waitFor("text:空消息体");

  await app.press("text:MSG-0001");
  await app.waitUntil(() => app.value(TOPIC_INPUT) === "order-topic");
  expect(app.value(TAG_INPUT)).toBe("TAG_A");
  expect(app.value(KEY_INPUT)).toBe("ORDER-1");
  expect(app.value(BODY_INPUT)).toBe(BODY);
  // 回填会清掉上一条结果提示。
  expect(app.shows("text:发送成功：MSG-0001")).toBe(false);
});

test("清空正文：只清正文与结果，历史仍保留", async () => {
  reset();
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.type(BODY_INPUT, BODY);
  await app.press("发送");
  await app.waitFor("text:发送成功：MSG-0001");

  await app.press("label:清空 >> nth=0");
  await app.waitUntil(() => app.shows("text:空消息体"));
  expect(app.shows("text:发送成功：MSG-0001")).toBe(false);
  expect(app.shows("text:MSG-0001")).toBe(true);
});
