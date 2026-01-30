const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');  // ← ADDED THIS
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Use system temp directory so nodemon doesn't restart ← CRITICAL FIX
const TEMP_DIR = path.join(os.tmpdir(), 'lex-compiler-temp');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Cleanup temp files older than 1 hour
function cleanupOldFiles() {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    files.forEach(file => {
        const filePath = path.join(TEMP_DIR, file);
        try {
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > 3600000) {
                fs.rmSync(filePath, { recursive: true, force: true });
            }
        } catch (err) {
            console.error('Cleanup error:', err);
        }
    });
}

setInterval(cleanupOldFiles, 600000);

// Helper function to quote paths for Windows
function quotePath(filePath) {
    if (process.platform === 'win32') {
        return `"${filePath}"`;
    }
    return filePath;
}

// Main compilation endpoint
app.post('/api/compile', async (req, res) => {
    const { lexCode, inputText } = req.body;

    if (!lexCode) {
        return res.status(400).json({ 
            success: false, 
            error: 'No Lex code provided' 
        });
    }

    const sessionId = uuidv4();
    const workDir = path.join(TEMP_DIR, sessionId);
    
    try {
        fs.mkdirSync(workDir);

        const lexFile = path.join(workDir, 'input.l');
        const cFile = path.join(workDir, 'lex.yy.c');
        const execFile = path.join(workDir, 'a.out');
        const execFileExe = path.join(workDir, 'a.exe');
        const inputFile = path.join(workDir, 'input.txt');

        fs.writeFileSync(lexFile, lexCode);
        if (inputText) {
            fs.writeFileSync(inputFile, inputText);
        }

        console.log('📂 Working directory:', workDir);
        console.log('📄 Lex file:', lexFile);

        // Step 1: Run flex
        const flexCmd = `flex ${quotePath(lexFile)}`;
        console.log('🔧 Running:', flexCmd);
        await runCommand(flexCmd, workDir);

        // Step 2: Compile with gcc
        const isWindows = process.platform === 'win32';
        const gccCmd = isWindows 
            ? `gcc ${quotePath(cFile)} -o ${quotePath(execFileExe)}`
            : `gcc ${quotePath(cFile)} -o ${quotePath(execFile)} -lfl`;
        
        console.log('🔨 Running:', gccCmd);
        await runCommand(gccCmd, workDir);

        // Step 3: Execute
        const finalExec = isWindows ? execFileExe : execFile;
        
        let executeCmd;
        if (inputText) {
            executeCmd = isWindows 
                ? `type ${quotePath(inputFile)} | ${quotePath(finalExec)}`
                : `${quotePath(finalExec)} < ${quotePath(inputFile)}`;
        } else {
            executeCmd = isWindows
                ? `echo. | ${quotePath(finalExec)}`
                : `echo "" | ${quotePath(finalExec)}`;
        }
        
        console.log('▶️ Running:', executeCmd);
        const output = await runCommand(executeCmd, workDir);

        cleanup(workDir);

        console.log('✅ Success! Output:', output);

        res.json({
            success: true,
            output: output,
            message: 'Compilation and execution successful'
        });

    } catch (error) {
        cleanup(workDir);
        console.error('❌ Error:', error.message);
        
        res.json({
            success: false,
            error: error.message,
            stage: error.stage || 'unknown'
        });
    }
});

function runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        console.log(`Running: ${command}`);
        console.log(`In directory: ${cwd}`);
        
        const shellOptions = {
            cwd, 
            timeout: 10000,
            shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
            windowsHide: true
        };
        
        exec(command, shellOptions, (error, stdout, stderr) => {
            if (error) {
                console.error('Error output:', stderr);
                console.error('Error message:', error.message);
                
                const err = new Error(stderr || error.message);
                err.stage = getStageFromCommand(command);
                reject(err);
            } else {
                console.log('Success output:', stdout);
                resolve(stdout);
            }
        });
    });
}

function getStageFromCommand(command) {
    if (command.includes('flex')) return 'flex';
    if (command.includes('gcc')) return 'compilation';
    return 'execution';
}

function cleanup(dir) {
    try {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    } catch (err) {
        console.error('Cleanup error:', err);
    }
}

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Server is running',
        platform: process.platform,
        tempDir: TEMP_DIR
    });
});

app.listen(PORT, () => {
    console.log(`✅ Lex Compiler Backend running on http://localhost:${PORT}`);
    console.log(`📂 Temp directory: ${TEMP_DIR}`);
    console.log(`💻 Platform: ${process.platform}`);
    console.log(`🔧 Flex support: ${process.platform === 'win32' ? 'Windows (no -lfl)' : 'Linux (with -lfl)'}`);
});