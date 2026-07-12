import { ColorType, CrosshairMode, type DeepPartial, type ChartOptions } from 'lightweight-charts'

export function chartOptions(dark: boolean): DeepPartial<ChartOptions> {
  return {
    autoSize: false,
    layout: {
      background: { type: ColorType.Solid, color: dark ? '#000000' : '#FFFFFF' },
      textColor: dark ? '#8E8E93' : '#6C6C70',
      fontFamily: '"SF Pro Text", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      fontSize: 11,
    },
    grid: {
      vertLines: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
      horzLines: { color: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#007AFF', width: 1, style: 2, labelBackgroundColor: '#007AFF' },
      horzLine: { color: '#007AFF', width: 1, style: 2, labelBackgroundColor: '#007AFF' },
    },
    rightPriceScale: {
      borderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    },
    timeScale: {
      borderColor: dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 6,
    },
    handleScroll: true,
    handleScale: true,
  }
}

export const CANDLE_COLORS = {
  up: '#34C759',
  down: '#FF3B30',
}
