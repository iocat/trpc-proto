fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=../generated/operations_v1.proto");
    tonic_build::configure()
        .compile_protos(&["../generated/operations_v1.proto"], &["../generated"])?;
    Ok(())
}
