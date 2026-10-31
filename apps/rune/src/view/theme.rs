//! T3 Code preset colors, mapped to Rune's semantic roles.
//! Preset source: T3 Code `apps/web/src/index.css`; see THIRD_PARTY_NOTICES.md.
use rune::{Color, color::hex};
use rune_kit::Kit;
use std::sync::OnceLock;

pub const OPTIONS: &[(&str, &str)] = &[
    ("default", "T3 Default"),
    ("opencode", "OpenCode"),
    ("catppuccin-auto", "Catppuccin (auto)"),
    ("catppuccin-latte", "Catppuccin Latte"),
    ("catppuccin-mocha", "Catppuccin Mocha"),
    ("github-dark", "GitHub Dark"),
    ("github-dark-default", "GitHub Dark Default"),
    ("github-dark-dimmed", "GitHub Dark Dimmed"),
    ("github-dark-high-contrast", "GitHub Dark High Contrast"),
    ("lilac", "Lilac"),
    ("nord", "Nord"),
    ("visual-studio-2017-dark", "Visual Studio Dark"),
    ("t3-chat-theme", "T3 Chat"),
];

pub fn appearance(preset: &str, mode_dark: bool) -> bool {
    match preset {
        "catppuccin-latte" => false,
        "catppuccin-mocha"
        | "github-dark"
        | "github-dark-default"
        | "github-dark-dimmed"
        | "github-dark-high-contrast"
        | "lilac"
        | "nord"
        | "visual-studio-2017-dark"
        | "t3-chat-theme" => true,
        _ => mode_dark,
    }
}
fn colors(id: &str, dark: bool) -> Option<[Color; 7]> {
    if id == "opencode" {
        return None;
    }
    if id == "default" {
        let values = if dark {
            [
                "#161616", "#f5f5f5", "#1e1e1e", "#8b5cf6", "#292929", "#a3a3a3", "#363636",
            ]
        } else {
            [
                "#ffffff", "#262626", "#fafafa", "#4f46e5", "#f2f2f2", "#737373", "#dedede",
            ]
        };
        return Some(values.map(|v| hex(v).expect("T3 default color")));
    }
    let id = if id == "catppuccin-auto" {
        if dark {
            "catppuccin-mocha"
        } else {
            "catppuccin-latte"
        }
    } else {
        id
    };
    static DATA: OnceLock<serde_json::Value> = OnceLock::new();
    let row = DATA
        .get_or_init(|| {
            serde_json::from_str(include_str!("../../assets/t3-theme-reference.json"))
                .expect("preset colors")
        })
        .get(id)?;
    let get = |name| row.get(name).and_then(|v| v.as_str()).and_then(hex);
    Some([
        get("background")?,
        get("foreground")?,
        get("card")?,
        get("primary")?,
        get("secondary")?,
        get("muted-foreground")?,
        get("border")?,
    ])
}

fn readable(mut ink: Color, bg: Color, foreground: Color) -> Color {
    let ratio = |a: Color, b: Color| {
        let (hi, lo) = if a.luminance() > b.luminance() {
            (a.luminance(), b.luminance())
        } else {
            (b.luminance(), a.luminance())
        };
        (hi + 0.05) / (lo + 0.05)
    };
    for _ in 0..20 {
        if ratio(ink, bg) >= 4.5 {
            break;
        }
        ink = ink.mix(foreground, 0.15);
    }
    ink
}

pub fn kit(id: &str, dark: bool) -> Kit {
    let mut k = rune_theme_opencode::kit(dark).clone();
    let Some([bg, fg, card, accent, secondary, muted, border]) = colors(id, dark) else {
        return k;
    };
    let muted = readable(muted, bg, fg);
    let on_accent = if accent.luminance() > 0.35 {
        Color::BLACK
    } else {
        Color::WHITE
    };
    let c = &mut k.c;
    c.page = bg;
    c.bg_base = bg;
    c.bg_deep = bg;
    c.layer_01 = card;
    c.layer_02 = secondary;
    c.layer_03 = secondary;
    c.layer_04 = secondary;
    c.bg_button_neutral = secondary;
    c.bg_accent = accent;
    c.text_contrast = on_accent;
    c.icon_contrast = on_accent;
    c.submit_fg = on_accent;
    c.submit_icon = on_accent;
    c.text_base = fg;
    c.text_strong = fg;
    c.text_muted = muted;
    c.text_weak = muted;
    c.text_faint = muted;
    c.text_accent = accent;
    c.icon_base = fg;
    c.icon_muted = muted;
    c.icon_faint = muted;
    c.icon_weaker = muted;
    c.icon_accent = accent;
    c.border_base = border;
    c.border_muted = border;
    c.border_weak = border;
    c.border_strong = border;
    c.border_hover = border;
    c.border_focus = accent;
    c.border_active = accent;
    c.hover = secondary;
    c.pressed = border;
    c.surface_base = bg;
    c.surface_weak = card;
    c.surface_hover = secondary;
    c.surface_raised = card;
    c.surface_raised_base = card;
    c.surface_raised_hover = secondary;
    c.surface_float = card;
    c.std_border = border;
    c.std_icon = muted;
    c.std_icon_strong = fg;
    c.std_text = fg;
    k.blend_over = Some(bg);
    k
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn presets_resolve_and_follow_or_pin_appearance() {
        for (id, _) in OPTIONS {
            for mode in [false, true] {
                let dark = appearance(id, mode);
                let k = kit(id, dark);
                assert_eq!(k.dark, dark);
                if *id != "opencode" {
                    assert!(colors(id, dark).is_some(), "{id}");
                }
            }
        }
        assert!(!appearance("catppuccin-latte", true));
        assert!(appearance("nord", false));
        assert!(!appearance("catppuccin-auto", false));
        assert!(appearance("catppuccin-auto", true));
        for (id, _) in OPTIONS {
            let dark = appearance(id, true);
            let k = kit(id, dark);
            if *id != "opencode" {
                let a = k.c.text_muted.luminance();
                let b = k.c.bg_base.luminance();
                let ratio = (a.max(b) + 0.05) / (a.min(b) + 0.05);
                assert!(ratio >= 4.5, "{id}: {ratio}");
            }
        }
    }
}
