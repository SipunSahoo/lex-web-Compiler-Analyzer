const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware configuration
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Set up temporary workspace directory outside the project folder
// so nodemon does not restart on temp file changes
const TEMP_DIR = path.join(os.tmpdir(), 'lex-compiler-temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Scheduled maintenance: clean up workspaces older than 1 hour to prevent disk bloat
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

// Helper: safely quote paths for shell commands (Windows vs POSIX)
function quotePath(filePath) {
    if (process.platform === 'win32') return `"${filePath}"`;
    return filePath;
}


// ==========================================
// COMPILER PHASE FILTERS (EDUCATIONAL LAYER)
// ==========================================

/**
 * FILTER 1 — Syntax Analysis (.original dump)
 *
 * Goal: Transform GCC's raw AST dump into a readable ASCII tree.
 * Strategy:
 *   - Strip all hex memory addresses (@0x...) and pointer tokens.
 *   - Track brace depth to calculate visual indentation level.
 *   - Label each line with a human-readable node type (IF NODE, ASSIGN NODE, etc.).
 *   - Draw ├── for mid-tree nodes and └── for the last child in a scope.
 */
function cleanSyntaxAST(raw) {
    if (!raw || raw.includes('Waiting')) return raw;

    // ── Step 1: Strip compiler internals that confuse students ──────────────────
    let cleaned = raw
        .replace(/@[0-9a-fx]+/gi, '')          // Remove hex memory addresses
        .replace(/<[a-z_]+ [0-9a-fx]+ /gi, '<') // Remove pointer-type prefixes
        .replace(/line \d+:\d+/g, '')           // Remove source-location markers
        .replace(/col \d+/g, '')                // Remove column markers
        .replace(/\bD\.[0-9]+\b/g, '');        // Remove GCC temp variable names

    // ── Step 2: Discard noise lines (compiler builtins, empty lines) ─────────────
    let lines = cleaned
        .split('\n')
        .map(l => l.trim())
        .filter(l =>
            l.length > 0 &&
            !l.includes('extern') &&
            !l.includes('typedef') &&
            !l.includes('__builtin') &&
            !l.includes('__attribute') &&
            l !== ';'
        );

    // ── Step 3: Build the ASCII tree with indentation tracking ──────────────────
    let indentLevel = 0;
    let treeLines = [];

    treeLines.push('=== PHASE 2: ABSTRACT SYNTAX TREE (AST) ===');
    treeLines.push('// The PARSER reads your flat token stream and builds a HIERARCHY.');
    treeLines.push('// Operations become parent nodes; variables and values become leaves.\n');
    treeLines.push('[ROOT NODE: PROGRAM]');

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Track scope blocks for indentation
        if (line === '{' || /^(if|while|for|try)\s*\(.*\)\s*\{$/.test(line)) {
            treeLines.push('│   '.repeat(indentLevel) + '├── [SCOPE BLOCK START ──▶]');
            indentLevel++;
            continue;
        }
        if (line === '}' || line === '};') {
            indentLevel = Math.max(0, indentLevel - 1);
            treeLines.push('│   '.repeat(indentLevel) + '└── [SCOPE BLOCK END ◀──]');
            continue;
        }

        // Apply student-friendly semantic labels based on statement type
        if (/^if\s/.test(line))          line = '[IF NODE] ─────── ' + line.replace(/^if\s*/, '');
        else if (/^else/.test(line))     line = '[ELSE BRANCH] ──── ' + line.replace(/^else\s*/, '');
        else if (/^while\s/.test(line))  line = '[LOOP NODE] ────── ' + line.replace(/^while\s*/, '');
        else if (/^for\s/.test(line))    line = '[FOR LOOP] ──────── ' + line.replace(/^for\s*/, '');
        else if (/^return\s/.test(line)) line = '[RETURN LEAF] ───── ' + line.replace(/^return\s*/, '');
        else if (/^goto\s/.test(line))   line = '[GOTO NODE] ────── ' + line.replace(/^goto\s*/, '');
        else if (line.includes('='))     line = '[ASSIGN NODE] ───── ' + line;
        else if (/\(.*\)/.test(line))   line = '[CALL NODE] ────── ' + line;
        else                             line = '[STMT NODE] ────── ' + line;

        // Determine branch symbol: last item in scope gets └── , others get ├──
        const isLast = (i === lines.length - 1) || (lines[i + 1] && lines[i + 1].trim() === '}');
        const branch = isLast ? '└── ' : '├── ';
        treeLines.push('│   '.repeat(indentLevel) + branch + line);
    }

    return treeLines.slice(0, 50).join('\n') + '\n\n... [Tree truncated for educational clarity. Full tree in raw GCC dump.]';
}


/**
 * FILTER 2 — Semantic Analysis (.gimple dump)
 * FILTER 5 — Code Optimization (.optimized dump)
 *
 * Goal: Display GIMPLE as textbook Three-Address Code (TAC).
 * Strategy:
 *   - GCC names temporaries as `D.XXXX` or `_N`. We replace these with
 *     sequential human names (t1, t2, t3...) using a live substitution Map.
 *   - This directly mirrors how TAC is taught in textbooks.
 *   - Filter out compiler-internal noise lines.
 */
function cleanGimple(raw, phaseTitle) {
    if (!raw || raw.includes('Waiting')) return raw;

    let header = `=== ${phaseTitle} ===\n`;
    header += '// The hierarchical AST has been FLATTENED into step-by-step linear instructions.\n';
    header += '// Complex expressions are broken into simple 3-operand steps: t1 = t2 op t3\n\n';

    // ── Live substitution map: each unique GCC temp gets a clean t-name ──────────
    const tempMap = new Map();
    let tempCounter = 1;

    function substituteLine(line) {
        // Match GCC temporary patterns: D.1234, _1, _2, etc.
        return line.replace(/\b(D\.[0-9]+|_[0-9]+)\b/g, (match) => {
            if (!tempMap.has(match)) {
                tempMap.set(match, `t${tempCounter++}`);
            }
            return tempMap.get(match);
        });
    }

    // ── Filter and clean each line ───────────────────────────────────────────────
    let lines = raw
        .split('\n')
        .map(l => l.trim())
        .filter(l =>
            l.length > 0 &&
            !l.includes('__attribute__') &&
            !l.includes('__FUNCTION__') &&
            !l.includes('unsigned char') &&
            !l.includes('unsigned int') &&
            !l.includes('typedef') &&
            !l.includes('extern') &&
            !l.includes('catch') &&
            !l.startsWith('//') &&
            l !== '{' &&
            l !== '}'
        )
        .map(substituteLine)
        .slice(0, 30);

    return header + lines.join('\n') + '\n\n... [Three-Address Code translation complete]';
}


/**
 * FILTER 4 — Intermediate Code Generation (.expand / RTL dump)
 *
 * Goal: Show how abstract variables are mapped to CPU registers.
 * Strategy:
 *   - RTL is Lisp-like. We only care about (set ...) and (call ...) expressions.
 *   - Strip memory annotation noise (alignment, access mode brackets).
 *   - A student should see: "a value is SET from memory into a register."
 */
function cleanRTL(raw) {
    if (!raw || raw.includes('Waiting')) return raw;

    let header = '=== PHASE 4: INTERMEDIATE CODE — REGISTER TRANSFER LANGUAGE (RTL) ===\n';
    header += '// Abstract variable names are now MAPPED to physical CPU registers (e.g. %eax, %rbp).\n';
    header += '// The (set dest src) instruction is the fundamental unit: move src into dest.\n\n';

    let lines = raw
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.includes('(set ') || l.includes('(call ') || l.includes('(return)'))
        .map(l =>
            l
            .replace(/\[:[a-z_]+ [^\]]*\]/g, '')   // Strip [:mode ...] memory annotations
            .replace(/\/\*[^*]*\*\//g, '')          // Strip inline C-style comments
            .replace(/\s{2,}/g, ' ')                // Collapse multiple spaces
            .trim()
        )
        .filter(l => l.length > 5)
        .slice(0, 25);

    if (lines.length === 0) {
        return header + '// RTL dump was empty or could not be parsed at this optimization level.\n// Try compiling with -O0 for a more verbose RTL output.';
    }

    return header + lines.join('\n') + '\n\n... [Only (set) and (call) transfer operations shown]';
}


/**
 * FILTER 6 — Code Generation (.s assembly dump)
 *
 * Goal: Show only pure CPU instruction mnemonics, no assembler boilerplate.
 * Strategy:
 *   - GCC's .s files are full of assembler directives (.globl, .align, .cfi_*, etc.)
 *     that are not executed — they are metadata for the linker/debugger.
 *   - We strip all lines starting with '.' and all label markers (LFB, LFE).
 *   - What remains are the actual CPU instructions the chip will execute.
 */
function cleanAssembly(raw) {
    if (!raw || raw.includes('Waiting')) return raw;

    let header = '=== PHASE 6: TARGET ASSEMBLY CODE (x86-64) ===\n';
    header += '// This is the final machine-dependent code. Each line is one CPU instruction.\n';
    header += '// Assembler directives (.globl, .align, .cfi) are stripped — they are linker metadata, not code.\n\n';

    let lines = raw
        .split('\n')
        .map(l => l.trim())
        .filter(l =>
            l.length > 0 &&
            !l.startsWith('.') &&         // Strip assembler directives
            !l.startsWith('#') &&         // Strip preprocessor remnants
            !/^LF[BE]\d+/.test(l) &&     // Strip GCC function begin/end markers
            !/^\.L\w+:$/.test(l)         // Strip internal label-only lines
        )
        .slice(0, 40);

    if (lines.length === 0) {
        return header + '// No assembly instructions found. Ensure -save-temps flag is active in gcc command.';
    }

    return header + lines.join('\n') + '\n\n... [Assembler directives removed. Only CPU instructions shown.]';
}


// ==========================================
// MAIN COMPILATION PIPELINE ENDPOINT
// ==========================================
app.post('/api/compile', async (req, res) => {
    const { lexCode, stdInText, fileInputText } = req.body;

    if (!lexCode) {
        return res.status(400).json({ success: false, error: 'No Lex code provided' });
    }

    const sessionId = uuidv4();
    const workDir = path.join(TEMP_DIR, sessionId);

    try {
        fs.mkdirSync(workDir);

        // ── Declare all file paths upfront for clarity ──────────────────────────
        const lexFile    = path.join(workDir, 'input.l');      // The student's .l source
        const cFile      = path.join(workDir, 'lex.yy.c');     // C file generated by flex
        const execFile   = path.join(workDir, 'a.out');        // POSIX compiled binary
        const execFileExe = path.join(workDir, 'a.exe');       // Windows compiled binary
        const inputFile  = path.join(workDir, 'input.txt');    // Physical file for fopen()
        const stdinFile  = path.join(workDir, 'stdin.txt');    // Piped into binary via < redirect
        const outputFile = path.join(workDir, 'output.txt');   // Written by student via fprintf(yyout,...)

        // ── Write all input files unconditionally ────────────────────────────────
        // FIX: Both files MUST always exist on disk before the binary runs.
        // Using `|| ""` ensures we never skip the write even when the frontend
        // sends an empty or absent field. fopen() will succeed and return an
        // empty file handle rather than NULL.
        fs.writeFileSync(lexFile, lexCode);
        fs.writeFileSync(inputFile, fileInputText || '');   // Always write — prevents fopen() NULL crash
        fs.writeFileSync(stdinFile, stdInText    || '');   // Always write — prevents stdin hang

        // ── PHASE 1: Lexical Analysis via Flex ──────────────────────────────────
        // flex -v prints DFA state machine statistics to stderr.
        // We redirect stderr to flex_stats.txt to capture them separately.
        const flexCmd = `flex -v ${quotePath(lexFile)} 2> flex_stats.txt`;
        await runCommand(flexCmd, workDir);

        let flexStats = '';
        try {
            const rawStats = fs.readFileSync(path.join(workDir, 'flex_stats.txt'), 'utf8');
            flexStats = '=== PHASE 1: LEXICAL ANALYSIS — FLEX DFA STATISTICS ===\n'
                + '// Flex compiled your regex rules into a Deterministic Finite Automaton (DFA).\n'
                + '// The stats below show how many states and transitions the state machine has.\n\n'
                + rawStats;
        } catch (e) {
            flexStats = 'Flex stats not available.';
        }

        // ── PHASES 2-6: Compile lex.yy.c with GCC X-Ray dump flags ─────────────
        // Each flag produces a different dump file we use for educational display:
        //   -fdump-tree-original  → raw AST before any optimization     (.original)
        //   -fdump-tree-gimple    → GIMPLE TAC representation            (.gimple)
        //   -fdump-rtl-expand     → Register Transfer Language           (.expand)
        //   -fdump-tree-optimized → Optimized GIMPLE tree                (.optimized)
        //   -save-temps           → Keeps the .s assembly file on disk
        const isWindows = process.platform === 'win32';
        const dumpFlags = '-fdump-tree-original -fdump-tree-gimple -fdump-rtl-expand -fdump-tree-optimized -O1 -save-temps';

        const gccCmd = isWindows
            ? `gcc ${dumpFlags} ${quotePath(cFile)} -o ${quotePath(execFileExe)}`
            : `gcc ${dumpFlags} ${quotePath(cFile)} -o ${quotePath(execFile)} -lfl`;

        await runCommand(gccCmd, workDir);

        // ── Read dump files produced by GCC ─────────────────────────────────────
        const generatedFiles = fs.readdirSync(workDir);
        const readDumpSafe = (extension, title) => {
            const file = generatedFiles.find(f => f.endsWith(extension));
            if (!file) return `// ${title} dump was not generated. Check GCC flags.`;
            try {
                return fs.readFileSync(path.join(workDir, file), 'utf8');
            } catch (e) {
                return `// Error reading ${title} dump file.`;
            }
        };

        // Run each dump through its educational filter
        const syntaxAst     = cleanSyntaxAST(readDumpSafe('.original',  'Syntax AST'));
        const semanticGimple = cleanGimple(readDumpSafe('.gimple',     'Semantic Gimple'),  'PHASE 3: SEMANTIC ANALYSIS — GIMPLE (TAC)');
        const icgRtl         = cleanRTL(readDumpSafe('.expand',        'RTL Intermediate'));
        const optimizedCode  = cleanGimple(readDumpSafe('.optimized',  'Optimized Tree'),   'PHASE 5: CODE OPTIMIZATION — OPTIMIZED GIMPLE (TAC)');
        const assemblyCode   = cleanAssembly(readDumpSafe('.s',        'Assembly'));

        // ── Execute the compiled binary with stdin piped in ──────────────────────
        // cwd is set to workDir inside runCommand, so fopen("input.txt", "r")
        // resolves correctly to the file we wrote above.
        const finalExec = isWindows ? execFileExe : execFile;
        const executeCmd = isWindows
            ? `type ${quotePath(stdinFile)} | ${quotePath(finalExec)}`
            : `${quotePath(finalExec)} < ${quotePath(stdinFile)}`;

        const terminalOutput = await runCommand(executeCmd, workDir);

        // ── Read output.txt if the student wrote to it via fprintf(yyout,...) ────
        let fileOutputText = '// No output.txt was generated.\n// Hint: Did you use fprintf(yyout, ...) in your lex actions?';
        if (fs.existsSync(outputFile)) {
            fileOutputText = fs.readFileSync(outputFile, 'utf8');
        }

        cleanup(workDir);

        res.json({
            success: true,
            terminalOutput: terminalOutput,
            fileOutput: fileOutputText,
            phases: {
                lexical:   flexStats,
                syntax:    syntaxAst,
                semantic:  semanticGimple,
                icg:       icgRtl,
                optimized: optimizedCode,
                codegen:   assemblyCode
            },
            message: 'Compilation and execution successful'
        });

    } catch (error) {
        cleanup(workDir);
        res.json({
            success: false,
            error: error.message,
            stage: error.stage || 'unknown'
        });
    }
});


// ==========================================
// UTILITIES
// ==========================================

/**
 * runCommand: Wraps child_process.exec in a Promise.
 * All commands run with cwd set to the session's workDir so that
 * relative file references like "input.txt" resolve correctly.
 */
function runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        const shellOptions = {
            cwd,
            timeout: 10000,
            shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
            windowsHide: true
        };

        exec(command, shellOptions, (error, stdout, stderr) => {
            if (error) {
                const err = new Error(stderr || error.message);
                err.stage = command.includes('flex') ? 'flex'
                          : command.includes('gcc')  ? 'compilation'
                          : 'execution';
                reject(err);
            } else {
                resolve(stdout);
            }
        });
    });
}

/**
 * cleanup: Silently removes the session's temp directory.
 * Called after all reads are complete to prevent disk accumulation.
 */
function cleanup(dir) {
    try {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
        // Silently ignore cleanup failures — temp dir will be caught by scheduled cleanup
    }
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
    console.log(`✅ Lex Compiler Backend running on port ${PORT}`);
});