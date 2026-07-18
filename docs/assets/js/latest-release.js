(async () => {
  try {
    const res = await fetch('https://api.github.com/repos/Person810/BidSheet/releases/latest');
    if (!res.ok) return;
    const data = await res.json();
    const version = data.tag_name;
    const exe = data.assets.find(a => a.name.endsWith('.exe'));
    if (exe) {
      document.getElementById('download-btn').href = exe.browser_download_url;
      document.getElementById('cta-download').href = exe.browser_download_url;
    }
    document.getElementById('version-text').textContent = version;
    document.getElementById('badge-text').textContent = 'Free & open source · ' + version;
  } catch (e) {}
})();
