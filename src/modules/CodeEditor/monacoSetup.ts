// @ts-expect-error - deep ESM import tanpa deklarasi tipe
import * as monacoApi from 'monaco-editor/esm/vs/editor/editor.api'
// @ts-expect-error - kontribusi bahasa dasar untuk syntax highlighting JS
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'
import type * as Monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

const monaco = monacoApi as typeof Monaco

self.MonacoEnvironment = {
  getWorker: (_workerId, label) => {
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

loader.config({ monaco })

// Kustomisasi tema iOS untuk Monaco
monaco.editor.defineTheme('ios-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8E8E93', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'AF52DE' },
    { token: 'number', foreground: '007AFF' },
    { token: 'string', foreground: 'FF3B30' },
    { token: 'function', foreground: '5856D6' },
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.lineHighlightBackground': '#F2F2F780',
    'editorLineNumber.foreground': '#C7C7CC',
    'editorGutter.background': '#FFFFFF',
  },
})

monaco.editor.defineTheme('ios-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8E8E93', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'BF5AF2' },
    { token: 'number', foreground: '0A84FF' },
    { token: 'string', foreground: 'FF453A' },
    { token: 'function', foreground: '5E5CE6' },
  ],
  colors: {
    'editor.background': '#000000',
    'editor.lineHighlightBackground': '#1C1C1E80',
    'editorLineNumber.foreground': '#48484A',
    'editorGutter.background': '#000000',
  },
})

// Autocomplete untuk API ctx QuantLab
monaco.languages.registerCompletionItemProvider('javascript', {
  provideCompletionItems: (model, position) => {
    const word = model.getWordUntilPosition(position)
    const range = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endColumn: word.endColumn,
    }
    const items = [
      { label: 'ctx.candles', detail: 'Array candle: {time, open, high, low, close, volume}' },
      { label: 'ctx.params', detail: 'Parameter script dari metadata' },
      { label: 'ctx.position', detail: 'Posisi terbuka saat ini (atau null)' },
      { label: 'ctx.balance', detail: 'Saldo akun simulasi' },
      { label: 'ctx.execPrice', detail: 'Harga eksekusi bar ini' },
      { label: 'ctx.buy', detail: 'buy({ sl, tp, signal })' },
      { label: 'ctx.sell', detail: 'sell({ sl, tp, signal })' },
      { label: 'ctx.close', detail: 'close(reason)' },
      { label: 'ctx.sma', detail: 'sma(period, i, src?)' },
      { label: 'ctx.ema', detail: 'ema(period, i, src?)' },
      { label: 'ctx.atr', detail: 'atr(period, i)' },
      { label: 'ctx.rsi', detail: 'rsi(period, i)' },
      { label: 'ctx.highest', detail: 'highest(period, i)' },
      { label: 'ctx.lowest', detail: 'lowest(period, i)' },
      { label: 'ctx.volumeSma', detail: 'volumeSma(period, i)' },
    ]
    return {
      suggestions: items.map((it) => ({
        ...it,
        kind: monaco.languages.CompletionItemKind.Property,
        insertText: it.label,
        range,
      })),
    }
  },
})

export { monaco }
