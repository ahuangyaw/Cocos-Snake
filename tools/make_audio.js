/**
 * 程序化音效合成器 —— 纯 Node 标准库，零外部依赖，零音频素材
 *
 * 【为什么用代码合成音效，而不是找现成的音频文件】
 *   1. 无版权风险、无外部依赖、仓库里不塞二进制素材
 *   2. 参数完全可控 —— 想调"更亮一点""更闷一点"改波形参数即可
 *   3. 音频是"手感"的核心：吃食物的音高随连击上升，是最廉价的正反馈
 *
 * 【合成的原理（很朴素，但足够做出好音效）】
 *   一个音效 = 若干「振荡器」叠加 + 一条「包络曲线」塑形
 *     - 振荡器：正弦/方波/三角波/噪声，各有音色
 *     - 包络：ADSR 或简单的指数衰减，决定"听起来是敲击还是拉长"
 *     - 扫频：频率随时间变化，能做出"上升/下降"的情绪暗示
 *
 * 输出：assets/audio/*.wav （16bit PCM，44100Hz）
 */
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const OUT_DIR = path.join(__dirname, '..', 'assets', 'resources', 'audio');

// ======================================================================
// WAV 编码（16bit PCM 单声道）
// ======================================================================
function encodeWav(samples, sampleRate = SAMPLE_RATE) {
    const n = samples.length;
    const buf = Buffer.alloc(44 + n * 2);

    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(36 + n * 2, 4);
    buf.write('WAVE', 8, 'ascii');
    buf.write('fmt ', 12, 'ascii');
    buf.writeUInt32LE(16, 16);              // fmt chunk 大小
    buf.writeUInt16LE(1, 20);               // PCM
    buf.writeUInt16LE(1, 22);               // 单声道
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);  // 字节率
    buf.writeUInt16LE(2, 32);               // 块对齐
    buf.writeUInt16LE(16, 34);              // 位深
    buf.write('data', 36, 'ascii');
    buf.writeUInt32LE(n * 2, 40);

    for (let i = 0; i < n; i++) {
        let v = Math.max(-1, Math.min(1, samples[i]));
        buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
    }
    return buf;
}

// ======================================================================
// 波形与工具
// ======================================================================
const TAU = Math.PI * 2;

/** 从 t 时刻的相位（弧度）取正弦值 */
const sine = (phase) => Math.sin(phase);
/** 方波：音色更"电子/攻击性" */
const square = (phase) => (Math.sin(phase) >= 0 ? 1 : -1);
/** 三角波：介于正弦与方波之间，温和但有存在感 */
const triangle = (phase) => 2 / Math.PI * Math.asin(Math.sin(phase));
/** 锯齿波：明亮、有"电流"感 */
function sawtooth(phase) {
    // 把相位归一化到 [0,1)，再线性映射到 [-1,1]
    let x = (phase / TAU) % 1;
    if (x < 0) x += 1;
    return 2 * x - 1;
}

/** 指数衰减包络：attack 秒升起，之后按 tau 衰减 */
function envExp(t, attack, tau) {
    if (t < 0) return 0;
    if (t < attack) return t / attack;
    return Math.exp(-(t - attack) / tau);
}

/** 平滑的钟形包络（快起快落，适合"叮"） */
function envBell(t, attack, release) {
    if (t < 0) return 0;
    if (t < attack) return t / attack;
    const k = (t - attack) / release;
    return k >= 1 ? 0 : Math.pow(1 - k, 2);
}

/** 线性插值 */
const lerp = (a, b, t) => a + (b - a) * t;

// ======================================================================
// 音效定义
// ======================================================================

/** 吃食物：明亮的上行"叮"，pitch 用于按连击升调 */
function synthEat(pitch = 0) {
    const dur = 0.16;
    const n = Math.floor(SAMPLE_RATE * dur);
    const out = new Float32Array(n);
    const base = 880 * Math.pow(2, pitch / 12);   // 半音为单位升调

    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const e = envBell(t, 0.004, dur * 0.92);

        // 主音：基频 + 八度泛音（让声音更"亮"）
        const f0 = base * (1 + 0.25 * t / dur);        // 轻微上行扫频
        const main = sine(TAU * f0 * t);
        const oct = 0.45 * sine(TAU * f0 * 2 * t);
        const tri = 0.25 * triangle(TAU * f0 * 0.5 * t);

        out[i] = (main * 0.6 + oct * 0.3 + tri * 0.1) * e * 0.55;
    }
    return out;
}

/** 转向：极短的"嗒"，几乎不占注意力，但不能没有 */
function synthTurn() {
    const dur = 0.05;
    const n = Math.floor(SAMPLE_RATE * dur);
    const out = new Float32Array(n);
    const attack = 0.0035;      // 3.5ms 起音：足够快（听感仍是"嗒"），又不会爆音
    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const e = envExp(t, attack, 0.013);
        // 高频短促 + 一点噪声，听起来像"机关扣动"
        const body = square(TAU * 1400 * t) * 0.35;
        const noise = (Math.random() * 2 - 1) * 0.25;
        out[i] = (body + noise) * e * 0.35;
    }
    return out;
}

/** 死亡：下行的坠落音 + 噪声撞击，情绪要"沉" */
function synthDeath() {
    const dur = 0.85;
    const n = Math.floor(SAMPLE_RATE * dur);
    const out = new Float32Array(n);

    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const k = t / dur;

        // 频率从 420Hz 滑到 60Hz —— 下滑音是"失败/坠落"的通用语汇
        const f = lerp(420, 60, Math.pow(k, 0.6));
        const e = envExp(t, 0.014, 0.30);     // 14ms 起音：够快但有过渡，避免爆音

        const main = sine(TAU * f * t);
        const sub = 0.6 * sine(TAU * f * 0.5 * t);        // 次低频，增加厚重感
        const dist = sawtooth(TAU * f * 1.5 * t) * 0.12;  // 一点失真，制造"撞坏"的粗糙感
        const noise = (Math.random() * 2 - 1) * Math.exp(-t / 0.09) * 0.35;

        out[i] = (main * 0.5 + sub * 0.3 + dist + noise) * e * 0.6;
    }
    return out;
}

/** 游戏结束：三音下行，明确的"结束"语气 */
function synthGameOver() {
    const notes = [523.25, 415.30, 311.13];   // C5 -> G#4 -> D#4
    const noteDur = 0.18;
    const total = noteDur * notes.length + 0.5;
    const n = Math.floor(SAMPLE_RATE * total);
    const out = new Float32Array(n);

    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        let acc = 0;
        for (let j = 0; j < notes.length; j++) {
            const lt = t - j * noteDur;
            if (lt < 0) continue;
            const e = envExp(lt, 0.008, 0.20);
            const f = notes[j];
            const main = sine(TAU * f * lt);
            const oct = 0.35 * sine(TAU * f * 2 * lt);
            acc += (main * 0.7 + oct * 0.3) * e;
        }
        out[i] = acc * 0.32;
    }
    return out;
}

/** 开局：两音上行，给人"要开始了"的期待 */
function synthStart() {
    const notes = [392.00, 587.33];   // G4 -> D5
    const noteDur = 0.11;
    const total = noteDur * notes.length + 0.25;
    const n = Math.floor(SAMPLE_RATE * total);
    const out = new Float32Array(n);

    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        let acc = 0;
        for (let j = 0; j < notes.length; j++) {
            const lt = t - j * noteDur;
            if (lt < 0) continue;
            const e = envBell(lt, 0.005, 0.22);
            acc += (sine(TAU * notes[j] * lt) * 0.7
                + 0.3 * triangle(TAU * notes[j] * 2 * lt)) * e;
        }
        out[i] = acc * 0.35;
    }
    return out;
}

/** 新纪录：明亮的三音上行 + 一点颤音，给玩家"被奖励"的感觉 */
function synthRecord() {
    const notes = [659.25, 783.99, 1046.50];
    const noteDur = 0.10;
    const total = noteDur * notes.length + 0.45;
    const n = Math.floor(SAMPLE_RATE * total);
    const out = new Float32Array(n);

    for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        let acc = 0;
        for (let j = 0; j < notes.length; j++) {
            const lt = t - j * noteDur;
            if (lt < 0) continue;
            const e = envBell(lt, 0.009, 0.3);    // 9ms 起音
            // 轻微颤音，让尾音不呆板
            const vib = 1 + 0.01 * Math.sin(TAU * 6 * lt);
            acc += (sine(TAU * notes[j] * vib * lt) * 0.65
                + 0.35 * sine(TAU * notes[j] * 2 * lt)) * e;
        }
        out[i] = acc * 0.33;
    }
    return out;
}

// ======================================================================
// 主流程
// ======================================================================
function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    const jobs = [
        // 吃食物：6 个升调版本，供连击时递增使用（这是最有效的正反馈设计）
        ['eat_0', synthEat(0)],
        ['eat_1', synthEat(2)],
        ['eat_2', synthEat(4)],
        ['eat_3', synthEat(7)],
        ['eat_4', synthEat(9)],
        ['eat_5', synthEat(12)],
        ['turn', synthTurn()],
        ['death', synthDeath()],
        ['gameover', synthGameOver()],
        ['start', synthStart()],
        ['record', synthRecord()],
    ];

    let total = 0;
    console.log('输出目录:', OUT_DIR);
    console.log('采样率: %d Hz, 位深: 16bit, 声道: 单声道', SAMPLE_RATE);
    console.log('='.repeat(62));

    for (const [name, samples] of jobs) {
        // 归一化到 -1..1，避免削波失真
        let peak = 0;
        for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
        if (peak > 0) {
            const gain = 0.92 / peak;
            for (let i = 0; i < samples.length; i++) samples[i] *= gain;
        }

        // 掐掉首尾的直流偏移（避免出现"咔"的爆音）
        for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-1, Math.min(1, samples[i]));

        const buf = encodeWav(samples);
        const p = path.join(OUT_DIR, name + '.wav');
        fs.writeFileSync(p, buf);
        total += buf.length;
        const secs = (samples.length / SAMPLE_RATE).toFixed(3);
        const size = String(buf.length).padStart(7);
        console.log(`  ${(name + '.wav').padEnd(14)} ${secs.padStart(6)} 秒  ${size} 字节`);
    }

    console.log('='.repeat(62));
    console.log(`共 ${jobs.length} 个文件, 合计 ${(total / 1024).toFixed(1)} KB`);
}

main();
