use serde::Deserialize;
use std::env;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::Command;

const MAGIC: &[u8; 4] = b"SQVM";
const TRAILER_SIZE: u64 = 8;

#[derive(Deserialize)]
struct VmConfig {
    arch: String,
    ram_mb: u64,
    cpu_count: u32,
    disk_gb: Option<u64>,
    display: String,
    extra_args: Vec<String>,
    qemu_binary_name: String,
    iso_name: String,
}

struct Payload {
    config: VmConfig,
    files: Vec<(String, Vec<u8>)>,
}

fn main() {
    let exe_path = env::current_exe().expect("cannot determine own path");
    let payload = read_payload(&exe_path);
    let work_dir = extract(&payload);
    run(&work_dir, &payload.config);
}

fn read_payload(exe_path: &std::path::Path) -> Payload {
    let mut file = File::open(exe_path).expect("cannot open own executable");
    let file_size = file.metadata().expect("cannot stat own executable").len();

    if file_size < TRAILER_SIZE + 4 {
        eprintln!("standq: file too small to be a vm executable");
        std::process::exit(1);
    }

    file.seek(SeekFrom::End(-(TRAILER_SIZE as i64))).unwrap();
    let mut size_buf = [0u8; 8];
    file.read_exact(&mut size_buf).unwrap();
    let payload_size = u64::from_le_bytes(size_buf);

    let payload_start = file_size - TRAILER_SIZE - payload_size;
    file.seek(SeekFrom::Start(payload_start)).unwrap();

    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).unwrap();
    if &magic != MAGIC {
        eprintln!("standq: not a valid standq vm executable (bad magic)");
        std::process::exit(1);
    }

    let mut ver_buf = [0u8; 4];
    file.read_exact(&mut ver_buf).unwrap();
    let _version = u32::from_le_bytes(ver_buf);

    let mut len_buf = [0u8; 8];
    file.read_exact(&mut len_buf).unwrap();
    let config_len = u64::from_le_bytes(len_buf) as usize;
    let mut config_buf = vec![0u8; config_len];
    file.read_exact(&mut config_buf).unwrap();
    let config: VmConfig = serde_json::from_slice(&config_buf).expect("cannot parse embedded config");

    // file count
    let mut count_buf = [0u8; 4];
    file.read_exact(&mut count_buf).unwrap();
    let file_count = u32::from_le_bytes(count_buf) as usize;

    // read file metadata: [name_len:4][name][executable:1][size:8]
    let mut file_meta = Vec::with_capacity(file_count);
    for _ in 0..file_count {
        let mut name_len_buf = [0u8; 4];
        file.read_exact(&mut name_len_buf).unwrap();
        let name_len = u32::from_le_bytes(name_len_buf) as usize;
        let mut name_buf = vec![0u8; name_len];
        file.read_exact(&mut name_buf).unwrap();
        let name = String::from_utf8(name_buf).unwrap();

        let mut exec_buf = [0u8; 1];
        file.read_exact(&mut exec_buf).unwrap();
        let executable = exec_buf[0] == 1;

        let mut size_buf = [0u8; 8];
        file.read_exact(&mut size_buf).unwrap();
        let size = u64::from_le_bytes(size_buf) as usize;

        file_meta.push((name, executable, size));
    }

    // read file data sequentially
    let mut files = Vec::with_capacity(file_count);
    for (name, executable, size) in file_meta {
        let _ = executable;
        let mut buf = vec![0u8; size];
        file.read_exact(&mut buf).unwrap();
        files.push((name, buf));
    }

    Payload { config, files }
}

fn extract(payload: &Payload) -> PathBuf {
    let temp = env::temp_dir().join(format!("standq-{}", std::process::id()));
    fs::create_dir_all(&temp).expect("cannot create temp directory");

    for (name, data) in &payload.files {
        let path = temp.join(name);
        fs::write(&path, data).unwrap_or_else(|e| panic!("cannot write {}: {}", name, e));

        #[cfg(unix)]
        let mode = if *name == payload.config.qemu_binary_name {
            0o755
        } else {
            0o644
        };
        #[cfg(unix)]
        fs::set_permissions(&path, fs::Permissions::from_mode(mode))
            .expect("cannot set permissions");
    }

    temp
}

fn run(dir: &std::path::Path, config: &VmConfig) -> ! {
    let qemu_path = dir.join(&config.qemu_binary_name);
    let iso_path = dir.join(&config.iso_name);

    let mut cmd = Command::new(&qemu_path);
    cmd.arg("-L").arg(dir);
    cmd.arg("-m").arg(config.ram_mb.to_string());
    cmd.arg("-smp").arg(config.cpu_count.to_string());
    cmd.arg("-cdrom").arg(&iso_path);
    cmd.arg("-display").arg(&config.display);

    if let Some(disk_gb) = config.disk_gb {
        let disk_path = dir.join("disk.qcow2");
        if !disk_path.exists() {
            let qemu_img = dir.join("qemu-img");
            let _ = Command::new(&qemu_img)
                .arg("create")
                .arg("-f")
                .arg("qcow2")
                .arg(&disk_path)
                .arg(format!("{}G", disk_gb))
                .status();
        }
        cmd.arg("-drive").arg(format!("file={},format=qcow2", disk_path.display()));
    }

    for arg in &config.extra_args {
        cmd.arg(arg);
    }

    match cmd.status() {
        Ok(status) => std::process::exit(status.code().unwrap_or(1)),
        Err(e) => {
            eprintln!("standq: failed to launch qemu: {}", e);
            std::process::exit(1);
        }
    }
}
