document.getElementById('build-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('status');
  const btn = e.target.querySelector('button');
  status.textContent = '';
  btn.disabled = true;
  btn.textContent = 'building...';

  const iso = document.getElementById('iso').files[0];
  const qemu = document.getElementById('qemu').files[0];
  const targetOs = document.getElementById('os').value;
  const arch = document.getElementById('arch').value;
  const ram = parseInt(document.getElementById('ram').value);
  const cpus = parseInt(document.getElementById('cpus').value);
  const diskInput = document.getElementById('disk').value;
  const disk = diskInput ? parseInt(diskInput) : null;
  const display = document.getElementById('display').value;

  const config = {
    target_os: targetOs,
    arch,
    ram_mb: ram,
    cpu_count: cpus,
    disk_gb: disk,
    display,
    extra_args: [],
    qemu_binary_name: qemu.name,
    iso_name: iso.name,
  };

  const form = new FormData();
  form.append('iso', iso);
  form.append('qemu', qemu);
  form.append('config', new Blob([JSON.stringify(config)], { type: 'application/json' }));

  try {
    const res = await fetch('/api/build', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'standq-vm';
    a.click();
    URL.revokeObjectURL(url);
    status.textContent = 'done';
    status.classList.add('ok');
  } catch (err) {
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'build exe';
  }
});
