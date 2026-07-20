// Basic friction against right-click "open/save image" on photos. Trivially
// bypassed (view-source, devtools, dragging out on some browsers) — this
// isn't real protection, just raises the bar past a casual right-click.
document.addEventListener('contextmenu', (e) => {
  if (e.target.tagName === 'IMG') e.preventDefault();
});
