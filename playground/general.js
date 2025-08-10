document.addEventListener('DOMContentLoaded', () => {
  // Cache DOM elements
  const runBtn = document.getElementById('runButton');
  const clearBtn = document.getElementById('clearButton');

  runBtn.addEventListener('click', runCode);    // <-- NO parentheses here
  clearBtn.addEventListener('click', clearOutput);

  // Initialize font size
  fontSize = 16;
  zoom(0); // set initial font sizes & display
});


const editor = document.getElementById('editor');
const output = document.getElementById('output');
let fontSize = 16;

// Clear output content
function clearOutput() {
  output.innerText = '';
}

// Zoom in/out both editor & output fonts
function zoom(change) {
  fontSize += change;
  if (fontSize < 10) fontSize = 10;
  if (fontSize > 50) fontSize = 50;

  editor.style.fontSize = fontSize + 'px';
  output.style.fontSize = fontSize + 'px';
  document.getElementById('fontSizeDisplay').innerText = fontSize + 'px';
}

// Attach zoom to global for buttons in HTML
window.zoom = zoom;
window.clearOutput = clearOutput;
