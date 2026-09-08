fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=../generated/stream_v1.proto");
    tonic_build::configure()
        .compile_protos(&["../generated/stream_v1.proto"], &["../generated"])?;
    Ok(())
}
