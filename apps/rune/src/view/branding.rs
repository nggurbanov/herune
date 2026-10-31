//! Product artwork is embedded so installed clients never depend on source paths.
use rune::{El, Pixels, SurfaceFit, el};
use std::sync::OnceLock;

pub fn logo(size: f32) -> El {
    static LOGO: OnceLock<Pixels> = OnceLock::new();
    let pixels = LOGO.get_or_init(|| {
        let image = image::load_from_memory(include_bytes!("../../assets/branding/icon-256.png"))
            .expect("embedded Herune logo must be a valid PNG")
            .into_rgba8();
        let pixels = Pixels::new();
        pixels.set(image.width(), image.height(), image.into_raw());
        pixels
    });
    el().size(size, size).pixels_fit(pixels, SurfaceFit::Fit)
}
