export function fmtDate(epochSec: number): string {
  if (!epochSec) return '-'
  return new Date(epochSec * 1000).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function fmtDateTime(epochSec: number): string {
  if (!epochSec) return '-'
  return new Date(epochSec * 1000).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtNum(n: number, digits = 2): string {
  if (!isFinite(n)) return '∞'
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtMoney(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${fmtNum(Math.abs(n))}`
}

export function fmtPct(n: number, digits = 2): string {
  return `${fmtNum(n, digits)}%`
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${fmtNum(bytes / 1024, 1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${fmtNum(bytes / (1024 * 1024), 1)} MB`
  return `${fmtNum(bytes / (1024 * 1024 * 1024), 2)} GB`
}

export function fmtDuration(sec: number): string {
  if (!sec || sec <= 0) return '0 hari'
  const days = Math.floor(sec / 86400)
  const hours = Math.floor((sec % 86400) / 3600)
  if (days > 0) return `${days} hari ${hours} jam`
  if (hours > 0) return `${hours} jam`
  return `${Math.floor(sec / 60)} menit`
}

export function epochToDateInput(epochSec: number): string {
  if (!epochSec) return ''
  const d = new Date(epochSec * 1000)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function dateInputToEpoch(s: string, endOfDay = false): number | undefined {
  if (!s) return undefined
  const d = new Date(s + (endOfDay ? 'T23:59:59' : 'T00:00:00'))
  return Math.floor(d.getTime() / 1000)
}
