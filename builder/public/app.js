function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function bindDrop(dropId) {
  const drop = document.getElementById(dropId);
  const input = drop.querySelector('input[type="file"]');

  input.addEventListener('change', () => update(drop, input));

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      update(drop, input);
    }
  });
}

function update(drop, input) {
  const file = input.files[0];
  if (!file) return;
  drop.classList.add('has-file');
  drop.querySelector('.drop-name').textContent = file.name;
  drop.querySelector('.drop-size').textContent = formatSize(file.size);
  updateEstimate();
}

function updateEstimate() {
  const el = document.getElementById('estimate');
  const iso = document.getElementById('iso').files[0];
  const qemu = document.getElementById('qemu').files[0];
  if (!iso && !qemu) return el.textContent = '';
  const total = (iso?.size || 0) + (qemu?.size || 0) + 600 * 1024;
  el.textContent = '~' + formatSize(total);
}

bindDrop('iso-drop');
bindDrop('qemu-drop');

document.getElementById('build-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('status');
  const btn = e.target.querySelector('button');
  status.textContent = '';
  status.classList.remove('ok');
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
    const ext = targetOs === 'win' ? '.exe' : '';
    a.download = 'standq-vm' + ext;
    a.click();
    URL.revokeObjectURL(url);
    status.textContent = 'done';
    status.classList.add('ok');
  } catch (err) {
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> build exe';
  }
});
