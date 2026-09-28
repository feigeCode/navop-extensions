use ironrdp::pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp::pdu::rdp::client_info::PerformanceFlags;
use ironrdp_client::config::{ClipboardType, Config, ConfigBuilder, Destination};

use crate::protocol::ConnectRequest;

pub(super) fn build_config(connect: ConnectRequest) -> anyhow::Result<Config> {
    let mut builder = ConfigBuilder::new()
        .with_destination(connect.destination.parse::<Destination>()?)
        .with_username(connect.username.unwrap_or_default())
        .with_password(connect.password.unwrap_or_default())
        .with_client_build(client_build()?)
        .with_client_dir("C:\\Windows\\System32\\mstscax.dll")
        .with_client_name(whoami::fallible::hostname().unwrap_or_else(|_| "navop-rdp".to_string()))
        .with_platform(platform_type())
        .with_tls(true)
        .with_credssp(true)
        .with_desktop_width(connect.width)
        .with_desktop_height(connect.height)
        .with_desktop_scale_factor(connect.scale_factor)
        .with_keyboard_type(ironrdp::pdu::gcc::KeyboardType::IBM_ENHANCED)
        .with_keyboard_subtype(0)
        .with_keyboard_layout(0)
        .with_keyboard_functional_keys_count(12)
        .with_ime_file_name("")
        .with_color_depth(32)
        .with_lossy_compression(true)
        .with_codecs(Vec::new())
        .with_autologon(true)
        .with_sound(connect.audio_playback)
        .with_server_pointer(true)
        .with_pointer_software_rendering(false)
        // GNOME Remote Desktop 50 refuses to serve a session at all unless the client
        // advertises the RDP Graphics Pipeline Extension in its Client Core Data early
        // capability flags, but advertising it also lets hosts that accept it encode the
        // session with codecs this helper does not decode. See EgfxPolicy for the default.
        .with_support_dyn_vc_gfx_protocol(EgfxPolicy::from_env().advertises())
        .with_performance_flags(PerformanceFlags::default())
        // Keep bulk compression disabled. ConfigBuilder defaults compression
        // to K64 unless with_compression(false) is set explicitly.
        .with_compression(false)
        .with_clipboard(ClipboardType::Enable);

    if let Some(domain) = connect.domain {
        builder = builder.with_domain(domain);
    }

    builder.build()
}

/// How the helper advertises the RDP Graphics Pipeline Extension (EGFX).
///
/// RdpClient registers an EGFX-capable dynamic channel either way; this only decides the
/// capability flag in the Client Core Data. Some hosts (GNOME Remote Desktop 50) refuse to serve
/// a session without it, while others (Windows) accept it and may then encode the session with
/// codecs this helper cannot decode. The default therefore connects without the flag and lets
/// RdpClient retry once when a host refuses the connection without it, which keeps both kinds of
/// host working. `NAVOP_RDP_EGFX=on` skips the extra attempt and `=off` never advertises.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum EgfxPolicy {
    Never,
    Fallback,
    Always,
}

impl EgfxPolicy {
    pub(super) fn from_env() -> Self {
        Self::parse(std::env::var("NAVOP_RDP_EGFX").ok().as_deref())
    }

    /// Advertises EGFX from the first attempt onwards.
    pub(super) fn advertises(self) -> bool {
        matches!(self, Self::Always)
    }

    /// Connects without EGFX and retries with it when a host refuses the connection.
    pub(super) fn retries_when_refused(self) -> bool {
        matches!(self, Self::Fallback)
    }

    fn parse(value: Option<&str>) -> Self {
        match value {
            Some("1" | "on" | "true" | "always") => Self::Always,
            Some("0" | "off" | "false" | "never") => Self::Never,
            _ => Self::Fallback,
        }
    }
}

fn client_build() -> anyhow::Result<u32> {
    let version = semver::Version::parse(env!("CARGO_PKG_VERSION"))?;
    Ok((version.major * 100 + version.minor * 10 + version.patch).try_into()?)
}

fn platform_type() -> MajorPlatformType {
    match whoami::platform() {
        whoami::Platform::Windows => MajorPlatformType::WINDOWS,
        whoami::Platform::Linux => MajorPlatformType::UNIX,
        whoami::Platform::MacOS => MajorPlatformType::MACINTOSH,
        whoami::Platform::Ios => MajorPlatformType::IOS,
        whoami::Platform::Android => MajorPlatformType::ANDROID,
        _ => MajorPlatformType::UNSPECIFIED,
    }
}

#[cfg(test)]
mod tests {
    use ironrdp::pdu::rdp::client_info::PerformanceFlags;

    use super::*;

    #[test]
    fn matches_ironrdp_viewer_performance_flags() {
        let config = build_config(ConnectRequest {
            destination: "127.0.0.1:3389".to_string(),
            username: None,
            password: None,
            domain: None,
            width: 1280,
            height: 720,
            scale_factor: 200,
            audio_playback: false,
            audio_capture: false,
            shared_folders: Vec::new(),
        })
        .expect("config builds");

        let flags = config.connector().performance_flags;
        assert_eq!(200, config.connector().desktop_scale_factor);
        assert_eq!(PerformanceFlags::default(), flags);
        assert!(!flags.contains(PerformanceFlags::DISABLE_THEMING));
        assert!(!flags.contains(PerformanceFlags::ENABLE_DESKTOP_COMPOSITION));
    }

    #[test]
    fn applies_requested_audio_playback_setting() {
        for audio_playback in [false, true] {
            let config = build_config(ConnectRequest {
                destination: "127.0.0.1:3389".to_string(),
                username: None,
                password: None,
                domain: None,
                width: 1280,
                height: 720,
                scale_factor: 100,
                audio_playback,
                audio_capture: false,
                shared_folders: Vec::new(),
            })
            .expect("config builds");

            assert_eq!(
                audio_playback,
                config.connector().enable_audio_playback,
                "connector audio playback must follow the Connect request"
            );
            assert_eq!(
                audio_playback,
                config.channels().sound,
                "RDPSND channel must follow the Connect request"
            );
        }
    }

    #[test]
    fn does_not_advertise_bulk_compression() {
        let config = build_config(ConnectRequest {
            destination: "127.0.0.1:3389".to_string(),
            username: None,
            password: None,
            domain: None,
            width: 1280,
            height: 720,
            scale_factor: 100,
            audio_playback: false,
            audio_capture: false,
            shared_folders: Vec::new(),
        })
        .expect("config builds");

        assert_eq!(None, config.connector().compression_type);
    }

    #[test]
    fn egfx_policy_defaults_to_a_retry_when_a_host_refuses_the_connection() {
        assert_eq!(EgfxPolicy::Fallback, EgfxPolicy::parse(None));
        assert_eq!(EgfxPolicy::Fallback, EgfxPolicy::parse(Some("auto")));
        assert_eq!(EgfxPolicy::Always, EgfxPolicy::parse(Some("on")));
        assert_eq!(EgfxPolicy::Never, EgfxPolicy::parse(Some("off")));

        assert!(!EgfxPolicy::Fallback.advertises());
        assert!(EgfxPolicy::Fallback.retries_when_refused());
        assert!(EgfxPolicy::Always.advertises());
        assert!(!EgfxPolicy::Always.retries_when_refused());
        assert!(!EgfxPolicy::Never.advertises());
        assert!(!EgfxPolicy::Never.retries_when_refused());
    }
}
