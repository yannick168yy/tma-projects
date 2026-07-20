import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

// 配色已通过 dataviz 校验（色觉障碍/对比度），低对比色依赖各页数据表格作 relief
export const BI_COLORS = {
  blue: '#2a78d6', green: '#008300', magenta: '#e87ba4', yellow: '#eda100',
  aqua: '#1baf7a', orange: '#eb6834', violet: '#4a3aa7', red: '#e34948',
}
// 分类序列固定顺序取色（相邻对已校验）
export const BI_SERIES_ORDER = [
  BI_COLORS.blue, BI_COLORS.green, BI_COLORS.magenta, BI_COLORS.yellow,
  BI_COLORS.aqua, BI_COLORS.orange, BI_COLORS.violet, BI_COLORS.red,
]

function useChart(render: (chart: echarts.ECharts) => void, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chartRef.current = chart
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (chartRef.current) render(chartRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return ref
}

export function LineChart({ dates, series, height = 300 }: {
  dates: string[]
  series: { name: string; color?: string; data: number[] }[]
  height?: number
}) {
  const ref = useChart((chart) => {
    chart.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross', label: { show: false } } },
      legend: { top: 0, textStyle: { color: '#52514e' } },
      grid: { left: 56, right: 16, top: 32, bottom: 24 },
      xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#ddd' } }, axisLabel: { color: '#52514e' } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0f0f0' } }, axisLabel: { color: '#52514e' } },
      series: series.map((s, i) => ({
        name: s.name, type: 'line', data: s.data,
        lineStyle: { width: 2 }, itemStyle: { color: s.color ?? BI_SERIES_ORDER[i % 8] },
        symbol: 'circle', symbolSize: 8, showSymbol: dates.length <= 31,
      })),
    }, true)
  }, [dates, series])
  return <div ref={ref} style={{ height }} />
}

export function PieChart({ data, height = 300, valueLabel = '' }: {
  data: { name: string; value: number }[]
  height?: number
  valueLabel?: string
}) {
  const ref = useChart((chart) => {
    chart.setOption({
      tooltip: { trigger: 'item', valueFormatter: (v: number) => `${Math.round(v).toLocaleString()}${valueLabel}` },
      series: [{
        type: 'pie', radius: ['36%', '68%'],
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        label: { color: '#52514e', formatter: '{b}\n{d}%' },
        data: data.map((d, i) => ({ ...d, itemStyle: { color: BI_SERIES_ORDER[i % 8] } })),
      }],
    }, true)
  }, [data])
  return <div ref={ref} style={{ height }} />
}

export function HBarChart({ data, height = 300, color = BI_COLORS.blue, valueLabel = '' }: {
  data: { name: string; value: number }[]
  height?: number
  color?: string
  valueLabel?: string
}) {
  const items = [...data].reverse() // echarts 纵轴从下往上
  const ref = useChart((chart) => {
    chart.setOption({
      tooltip: { trigger: 'item', valueFormatter: (v: number) => `${Math.round(v).toLocaleString()}${valueLabel}` },
      grid: { left: 140, right: 32, top: 8, bottom: 24 },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: '#f0f0f0' } }, axisLabel: { color: '#52514e' } },
      yAxis: { type: 'category', data: items.map((d) => d.name), axisLabel: { color: '#52514e', width: 130, overflow: 'truncate' } },
      series: [{
        type: 'bar', data: items.map((d) => d.value),
        itemStyle: { color, borderRadius: [0, 4, 4, 0] }, barMaxWidth: 18,
      }],
    }, true)
  }, [data])
  return <div ref={ref} style={{ height }} />
}
