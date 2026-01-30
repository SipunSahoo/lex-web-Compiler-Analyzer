const API_URL = 'https://lex-web-compiler-analyzer.onrender.com';

// Example Lex code
const exampleLexCode = `%{
#include <stdio.h>
int word_count = 0;
int char_count = 0;
int line_count = 0;
%}

%%
[a-zA-Z]+  { word_count++; char_count += yyleng; }
\\n         { line_count++; char_count++; }
.          { char_count++; }
%%

int yywrap() {
    return 1;
}

int main() {
    yylex();
    printf("Lines: %d\\n", line_count);
    printf("Words: %d\\n", word_count);
    printf("Characters: %d\\n", char_count);
    return 0;
}`;

const exampleInput = `Hello World
This is a test
Counting words and lines
Lexical Analysis Demo`;

// Wait for DOM to load
window.addEventListener('DOMContentLoaded', function() {
    console.log('✅ Page loaded');
    
    const lexCodeArea = document.getElementById('lexCode');
    const inputTextArea = document.getElementById('inputText');
    const outputPre = document.getElementById('output');
    const compileBtn = document.getElementById('compileBtn');
    const lineNumbers = document.getElementById('lineNumbers');
    const lineCount = document.getElementById('lineCount');
    
    // Update line numbers
    function updateLineNumbers() {
        const lines = lexCodeArea.value.split('\n').length;
        lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
    }
    
    function updateLineCount() {
        const lines = lexCodeArea.value.split('\n').length;
        lineCount.textContent = 'Lines: ' + lines;
    }
    
    // Load Example Button
    document.getElementById('loadExample').addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        lexCodeArea.value = exampleLexCode;
        inputTextArea.value = exampleInput;
        updateLineNumbers();
        updateLineCount();
        showToast('Example loaded successfully!', 'success');
        
        return false;
    });
    
    // Clear All Button (NEW)
    document.getElementById('clearAll').addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        if (confirm('Clear all code and input?')) {
            lexCodeArea.value = '';
            inputTextArea.value = '';
            outputPre.innerHTML = '<span class="output-placeholder"><i class="fas fa-info-circle"></i> Output will appear here after compilation...</span>';
            updateLineNumbers();
            updateLineCount();
            showToast('All cleared!', 'success');
        }
        
        return false;
    });
    
    // Clear Output Button
    document.getElementById('clearOutput').addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        outputPre.innerHTML = '<span class="output-placeholder"><i class="fas fa-info-circle"></i> Output will appear here after compilation...</span>';
        showToast('Output cleared', 'success');
        
        return false;
    });
    
    // Clear Input Button
    document.getElementById('clearInput').addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        inputTextArea.value = '';
        showToast('Input cleared', 'success');
        
        return false;
    });
    
    // Copy Code Button
    document.getElementById('copyCode').addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        navigator.clipboard.writeText(lexCodeArea.value).then(function() {
            showToast('Code copied to clipboard!', 'success');
        }).catch(function() {
            showToast('Failed to copy code', 'error');
        });
        
        return false;
    });
    
    // Copy Output Button
    document.getElementById('copyOutput').addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        navigator.clipboard.writeText(outputPre.textContent).then(function() {
            showToast('Output copied to clipboard!', 'success');
        }).catch(function() {
            showToast('Failed to copy output', 'error');
        });
        
        return false;
    });
    
    // Download Code Button
    document.getElementById('downloadCode').addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const blob = new Blob([lexCodeArea.value], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'program.l';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Code downloaded!', 'success');
        
        return false;
    });
    
    // Download Output Button
    document.getElementById('downloadOutput').addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const text = outputPre.textContent.replace(/^\s+|\s+$/g, '');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'output.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Output downloaded!', 'success');
        
        return false;
    });
    
    // Paste Input Button
    document.getElementById('pasteInput').addEventListener('click', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        try {
            const text = await navigator.clipboard.readText();
            inputTextArea.value = text;
            showToast('Pasted from clipboard!', 'success');
        } catch (err) {
            showToast('Failed to paste', 'error');
        }
        
        return false;
    });
    
    // COMPILE BUTTON - THE MOST IMPORTANT ONE
    compileBtn.addEventListener('click', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        console.log('🔵 COMPILE BUTTON CLICKED');
        
        const lexCode = lexCodeArea.value.trim();
        const inputText = inputTextArea.value;
        
        console.log('📝 Lex Code:', lexCode.substring(0, 50) + '...');
        console.log('📝 Input Text:', inputText);
        
        if (!lexCode) {
            outputPre.innerHTML = '<span style="color: #ef4444;">Error: No Lex code provided</span>';
            showToast('Please enter Lex code', 'error');
            return false;
        }
        
        // Show compiling status
        outputPre.innerHTML = '<span style="color: #f59e0b;"><i class="fas fa-spinner fa-spin"></i> Compiling...</span>';
        compileBtn.disabled = true;
        compileBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Compiling...</span>';
        
        try {
            console.log('📡 Sending request to:', API_URL + '/compile');
            
            const response = await fetch(API_URL + '/api/compile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lexCode: lexCode,
                    inputText: inputText
                })
            });
            
            console.log('📥 Response status:', response.status);
            
            const result = await response.json();
            console.log('📦 Result:', result);
            
            if (result.success) {
                console.log('✅ SUCCESS! Output:', result.output);
                
                // Display output in green
                outputPre.innerHTML = '<span style="color: #10b981;">' + escapeHtml(result.output) + '</span>';
                showToast('✅ Compilation successful!', 'success');
                
            } else {
                console.log('❌ FAILED:', result.error);
                
                // Display error in red
                outputPre.innerHTML = '<span style="color: #ef4444;">Error in ' + result.stage + ':\n' + escapeHtml(result.error) + '</span>';
                showToast('❌ Compilation failed', 'error');
            }
            
        } catch (error) {
            console.error('🔥 Network Error:', error);
            
            outputPre.innerHTML = '<span style="color: #ef4444;">Network Error: ' + escapeHtml(error.message) + '\n\n' +
                'Make sure the backend server is running on ' + API_URL + '</span>';
            showToast('❌ Connection failed', 'error');
            
        } finally {
            // Re-enable button
            compileBtn.disabled = false;
            compileBtn.innerHTML = '<i class="fas fa-play"></i> <span>Compile & Run</span>';
        }
        
        return false;
    });
    
    // Text area input listener
    lexCodeArea.addEventListener('input', function() {
        updateLineNumbers();
        updateLineCount();
    });
    
    // Sync scroll
    lexCodeArea.addEventListener('scroll', function() {
        lineNumbers.scrollTop = lexCodeArea.scrollTop;
    });
    
    // Initialize
    updateLineNumbers();
    updateLineCount();
    checkServerHealth();
});

// Helper: Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show toast notification
function showToast(message, type) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    toast.innerHTML = '<i class="fas ' + icon + '"></i><span>' + message + '</span>';
    
    container.appendChild(toast);
    
    setTimeout(function() {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(function() {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3000);
}

// Check server health
async function checkServerHealth() {
    const serverStatus = document.getElementById('serverStatus');
    if (!serverStatus) return;
    
    try {
        const response = await fetch(API_URL + '/api/health');
        if (response.ok) {
            serverStatus.innerHTML = '<div class="status-dot"></div><span>Online</span>';
            serverStatus.classList.add('online');
            console.log('✅ Backend server is running');
        } else {
            serverStatus.innerHTML = '<div class="status-dot"></div><span>Offline</span>';
            serverStatus.classList.add('offline');
        }
    } catch (error) {
        serverStatus.innerHTML = '<div class="status-dot"></div><span>Offline</span>';
        serverStatus.classList.add('offline');
        console.warn('⚠️ Backend server not reachable');
    }
}

// Check health every 30 seconds
setInterval(checkServerHealth, 30000);