// 1. Dynamic Environment Routing
// This checks if you are running Live Server locally or viewing via GitHub Pages
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000' 
    : 'https://lex-web-compiler-analyzer.onrender.com';

// 2. The Simple Example Code (No File I/O)
// This serves as BOTH our placeholder and our Load Example template
const simpleLexCode = `%{
#include <stdio.h>
%}

%%
[0-9]+      { printf("Terminal -> Found Number: %s\\n", yytext); }
[a-zA-Z]+   { printf("Terminal -> Found Word: %s\\n", yytext); }
[ \\t\\n]+  { /* Ignore whitespace */ }
.           { printf("Unknown: %s\\n", yytext); }
%%

int yywrap() { return 1; }

int main() {
    printf("--- Simple Lexical Analysis Started ---\\n");
    yylex();
    printf("--- Execution Finished ---\\n");
    return 0;
}`;

window.addEventListener('DOMContentLoaded', function() {
    const lexCodeArea = document.getElementById('lexCode');
    const stdInArea = document.getElementById('io-stdin');
    const fileInArea = document.getElementById('io-input-file');
    const fileOutArea = document.getElementById('io-output-file');
    const outputPre = document.getElementById('output');
    const compileBtn = document.getElementById('compileBtn');
    const lineNumbers = document.getElementById('lineNumbers');
    const lineCount = document.getElementById('lineCount');
    
    // --- INITIALIZATION ---
    // Set the simple code as a "ghost" placeholder.
    lexCodeArea.value = ''; 
    lexCodeArea.placeholder = simpleLexCode;
    
    stdInArea.value = '';
    stdInArea.placeholder = "Hello World 2026\nTesting terminal input 123";
    
    function updateLineNumbers() {
        // If the editor is empty, split('\n') returns an array of length 1.
        const lines = lexCodeArea.value.split('\n').length;
        lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
        if (lineCount) lineCount.textContent = 'Lines: ' + lines;
    }
    
    // Trigger line numbers calculation on load
    updateLineNumbers();
    
    // --- EVENT LISTENERS ---
    
    // Load Example now correctly brings in the SIMPLE code (no files)
    document.getElementById('loadExample').addEventListener('click', function(e) {
        e.preventDefault();
        lexCodeArea.value = simpleLexCode;
        stdInArea.value = "Terminal Input Data 123\nHello World!";
        fileInArea.value = ""; // Explicitly keeping file input empty
        updateLineNumbers();
        showToast('Example loaded!', 'success');
    });
    
    document.getElementById('clearAll').addEventListener('click', function(e) {
        e.preventDefault();
        if (confirm('Clear all code and inputs?')) {
            lexCodeArea.value = ''; 
            stdInArea.value = ''; 
            fileInArea.value = '';
            fileOutArea.innerHTML = '<span class="output-placeholder">Generated output.txt will appear here...</span>';
            outputPre.innerHTML = '<span class="output-placeholder">Output will appear here after compilation...</span>';
            resetPhases();
            updateLineNumbers(); 
            showToast('All cleared!', 'success');
        }
    });

    // Decoupled Stream Panel Selector (Tabs)
    const ioTabBtns = document.querySelectorAll('.io-tab-btn');
    const ioViews = document.querySelectorAll('.io-view');
    ioTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            ioTabBtns.forEach(b => b.classList.remove('active'));
            ioViews.forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.getAttribute('data-target')).classList.add('active');
        });
    });

    document.getElementById('clearActiveInput').addEventListener('click', function(e) {
        e.preventDefault();
        const activeView = document.querySelector('.io-view.active');
        if (activeView && activeView.tagName === 'TEXTAREA') { 
            activeView.value = ''; 
            showToast('Active input cleared', 'success'); 
        } else { 
            showToast('Cannot clear read-only view', 'warning'); 
        }
    });
    
    document.getElementById('copyCode').addEventListener('click', function(e) {
        e.preventDefault(); 
        document.execCommand('copy'); // Fallback for iFrame safety
        navigator.clipboard.writeText(lexCodeArea.value).catch(()=> /* ignore */{}); 
        showToast('Code copied!', 'success');
    });

    document.getElementById('downloadCode').addEventListener('click', function(e) {
        e.preventDefault();
        const blob = new Blob([lexCodeArea.value], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'program.l';
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        showToast('File downloaded!', 'success');
    });

    function resetPhases() {
        document.getElementById('phase-1-out').innerHTML = '<span class="placeholder">Waiting for compilation...</span>';
        document.getElementById('phase-2-out').innerHTML = '<span class="placeholder">Waiting for AST dump...</span>';
        document.getElementById('phase-3-out').innerHTML = '<span class="placeholder">Waiting for Semantic dump...</span>';
        document.getElementById('phase-4-out').innerHTML = '<span class="placeholder">Waiting for RTL dump...</span>';
        document.getElementById('phase-5-out').innerHTML = '<span class="placeholder">Waiting for Optimization dump...</span>';
        document.getElementById('phase-6-out').innerHTML = '<span class="placeholder">Target code will appear here...</span>';
    }

    compileBtn.addEventListener('click', async function(e) {
        e.preventDefault();
        
        const lexCode = lexCodeArea.value.trim();
        const stdInText = stdInArea.value; 
        const fileInputText = fileInArea.value; 
        
        // Logical check: If the user just looks at the placeholder but doesn't type
        // anything, `lexCode` will be empty. This prevents them from sending an empty request.
        if (!lexCode) { 
            showToast('Please enter Lex code', 'error'); 
            return; 
        }
        
        outputPre.innerHTML = '<span style="color: #f59e0b;"><i class="fas fa-spinner fa-spin"></i> Compiling...</span>';
        fileOutArea.innerHTML = '<span style="color: #f59e0b;">Fetching output.txt...</span>';
        compileBtn.disabled = true;
        compileBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Compiling...</span>';
        
        for (let i = 1; i <= 6; i++) {
            document.getElementById(`phase-${i}-out`).innerHTML = '<i class="fas fa-spinner fa-spin" style="color: var(--primary);"></i> Extracting phase data...';
        }
        
        try {
            const response = await fetch(API_URL + '/api/compile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lexCode, stdInText, fileInputText })
            });
            
            const result = await response.json();
            
            if (result.success) {
                outputPre.innerHTML = '<span style="color: #10b981;">' + escapeHtml(result.terminalOutput) + '</span>';
                fileOutArea.textContent = result.fileOutput;
                
                const phases = result.phases || {};
                document.getElementById('phase-1-out').textContent = phases.lexical || "Missing.";
                document.getElementById('phase-2-out').textContent = phases.syntax || "Missing.";
                document.getElementById('phase-3-out').textContent = phases.semantic || "Missing.";
                document.getElementById('phase-4-out').textContent = phases.icg || "Missing.";
                document.getElementById('phase-5-out').textContent = phases.optimized || "Missing.";
                document.getElementById('phase-6-out').textContent = phases.codegen || "Missing.";

                showToast('✅ Compilation successful!', 'success');
            } else {
                outputPre.innerHTML = '<span style="color: #ef4444;">Error:\n' + escapeHtml(result.error) + '</span>';
                showToast('❌ Compilation failed', 'error');
            }
        } catch (error) {
            outputPre.innerHTML = '<span style="color: #ef4444;">Network Error: ' + escapeHtml(error.message) + '</span>';
            showToast('❌ Connection failed', 'error');
        } finally {
            compileBtn.disabled = false;
            compileBtn.innerHTML = '<i class="fas fa-play"></i> <span>Compile & Run</span>';
        }
    });
    
    lexCodeArea.addEventListener('input', updateLineNumbers);
    lexCodeArea.addEventListener('scroll', () => lineNumbers.scrollTop = lexCodeArea.scrollTop);
    
    checkServerHealth();
});

function escapeHtml(text) { 
    if (!text) return ""; 
    const div = document.createElement('div'); 
    div.textContent = text; 
    return div.innerHTML; 
}

function showToast(message, type) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.animation = 'slideIn 0.3s ease reverse'; setTimeout(() => toast.remove(), 300); }, 3000);
}

async function checkServerHealth() {
    try {
        const response = await fetch(API_URL + '/api/health');
        if (response.ok) {
            const ind = document.getElementById('serverStatus');
            ind.innerHTML = '<div class="status-dot"></div><span>Online</span>';
            ind.className = 'status-indicator online';
        }
    } catch (error) {
        const ind = document.getElementById('serverStatus');
        ind.innerHTML = '<div class="status-dot"></div><span>Offline</span>';
        ind.className = 'status-indicator offline';
    }
}
setInterval(checkServerHealth, 30000);