//! Adapted from anomalyco/rune examples/opencode/src/palette.rs at
//! 3f70cd6b675c89a8a7b64fc09b1bf2b455e0ad1a.
//! Copyright (c) 2026 Christopher Langton. MIT licensed.
//!
//! OpenCode's v2 tokens, resolved once per appearance from `assets/theme.json`
//! (generated from `@opencode/ui` by `tools/theme.py`).

use std::sync::OnceLock;

use rune::{Color, Theme};

#[derive(Clone, Copy, Debug)]
pub struct Pal {
    pub dark: bool,
    pub bg_base: Color,
    pub layer1: Color,
    pub layer2: Color,
    pub layer3: Color,
    pub text: Color,
    pub muted: Color,
    pub faint: Color,
    pub accent: Color,
    pub border: Color,
    pub border_muted: Color,
    pub shadow: Color,
    pub inline_code_bg: Color,
    pub avatar_fg: Color,
    pub avatars: [(Color, Color); 9],
}

const THEME: &str = include_str!("../../assets/opencode-theme.json");

fn build(dark: bool) -> Pal {
    let t = Theme::from_json(THEME, dark).unwrap_or_else(|e| panic!("{e}"));
    let c = |n: &str| t.color(n);
    let avatar = |n: &str| {
        (
            c(&format!("avatar-bg-{n}")),
            c(&format!("avatar-border-{n}")),
        )
    };
    let text = c("text-text-base");
    let layer2 = c("background-bg-layer-02");
    Pal {
        dark,
        bg_base: c("background-bg-base"),
        layer1: c("background-bg-layer-01"),
        layer2,
        layer3: c("background-bg-layer-03"),
        text,
        muted: c("text-text-muted"),
        faint: c("text-text-faint"),
        accent: c("text-text-accent"),
        border: c("border-border-base"),
        border_muted: c("border-border-muted"),
        shadow: if dark {
            c("alpha-dark-30")
        } else {
            c("alpha-dark-8")
        },
        // color-mix(in oklch, text-base 8%, transparent)
        inline_code_bg: t.alpha(text, 0.08),
        avatar_fg: c("avatar-fg"),
        avatars: [
            avatar("orange"),
            avatar("yellow"),
            avatar("cyan"),
            avatar("green"),
            avatar("red"),
            avatar("pink"),
            avatar("blue"),
            avatar("purple"),
            avatar("gray"),
        ],
    }
}

pub fn pal(dark: bool) -> &'static Pal {
    static DARK: OnceLock<Pal> = OnceLock::new();
    static LIGHT: OnceLock<Pal> = OnceLock::new();
    if dark {
        DARK.get_or_init(|| build(true))
    } else {
        LIGHT.get_or_init(|| build(false))
    }
}

/// Map shared component tokens to the transcript and sidebar roles.
pub fn from_kit(base: &Pal, k: &rune_kit::Kit) -> Pal {
    let mut p = *base;
    p.dark = k.dark;
    p.bg_base = k.c.bg_base;
    p.layer1 = k.c.layer_01;
    p.layer2 = k.c.layer_02;
    p.layer3 = k.c.layer_03;
    p.text = k.c.text_base;
    p.muted = k.c.text_muted;
    p.faint = k.c.text_faint;
    p.accent = k.c.text_accent;
    p.border = k.c.border_base;
    p.border_muted = k.c.border_muted;
    p.inline_code_bg = k.c.layer_02;
    p
}
