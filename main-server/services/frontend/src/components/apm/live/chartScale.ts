import { createContext } from 'react'

/** 확대 오버레이 안에서 차트 글자를 키울 때의 배율 (기본 카드는 1) */
export const ZOOM_CHART_SCALE = 1.2

/** 위젯 카드(1)와 확대 오버레이(>1)에서 쓰는 차트 글자 크기(px)와 축 라벨 폭 */
export const chartFonts = (scale: number) =>
  scale > 1
    ? { axis: 12, legend: 13, yAxisW: 56, timePad: 60 }
    : { axis: 10, legend: 12, yAxisW: 44, timePad: 48 }

export const ChartScaleContext = createContext(1)
