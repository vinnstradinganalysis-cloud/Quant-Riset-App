/// <reference lib="webworker" />
/*
 * Sandbox validation: mengevaluasi kode JS hanya untuk mendeteksi Syntax Error.
 * Kode dijalankan dalam lingkup fungsi terisolasi tanpa akses ke UI utama.
 */
self.onmessage = (e: MessageEvent) => {
  const { code, id } = e.data as { code: string; id: string }
  try {
    // Deteksi fungsi utama: onBar (strategy) atau calculate (indicator)
    const factory = new Function(
      `"use strict";\n${code}\n;return typeof onBar === 'function' ? 'onBar' : (typeof calculate === 'function' ? 'calculate' : null);`,
    )
    const kind = factory()
    if (!kind) {
      self.postMessage({
        type: 'result',
        id,
        ok: false,
        message: 'Kode valid secara sintaks, namun tidak ditemukan fungsi utama `onBar(ctx, i)` (strategy) atau `calculate(ctx, i)` (indicator).',
      })
      return
    }
    self.postMessage({ type: 'result', id, ok: true, kind, message: `Compilation Success — entry point: ${kind}()` })
  } catch (err) {
    const e2 = err as SyntaxError
    // coba ekstrak nomor baris dari stack
    let line: number | null = null
    const m = /(?:eval|<anonymous>):(\d+):\d+/.exec(e2.stack || '')
    if (m) line = Math.max(1, parseInt(m[1], 10) - 2)
    self.postMessage({
      type: 'result',
      id,
      ok: false,
      line,
      message: `${line ? `Line ${line}: ` : ''}${e2.message}`,
    })
  }
}
