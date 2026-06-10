"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UiThemeMode } from "../../types";
import {
  GRAPH_FONT_FAMILY,
  TIMEBAR_HEIGHT,
  TIMEBAR_HORIZONTAL_PADDING,
  getTimebarMetrics,
  getTrendPointY,
  pixelToDay,
  timelineToPixel,
} from "./temporal-graph-utils";

interface TimeBarProps {
  totalDays: number;
  dayCounts: number[];
  currentDay: number;
  themeMode?: UiThemeMode;
  onChange: (day: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  ariaLabel?: string;
}

type Point = {
  x: number;
  y: number;
};

function getFutureAreaFill(themeMode: UiThemeMode) {
  return themeMode === "dark" ? "rgba(180, 178, 168, 0.16)" : "rgba(100, 98, 90, 0.12)";
}

function getActiveAreaFill(themeMode: UiThemeMode) {
  return themeMode === "dark" ? "rgba(180, 178, 168, 0.28)" : "rgba(100, 98, 90, 0.22)";
}

function getFutureLineStroke(themeMode: UiThemeMode) {
  return themeMode === "dark"
    ? "rgba(180, 178, 168, 0.52)"
    : "rgba(100, 98, 90, 0.38)";
}

function getActiveLineStroke(themeMode: UiThemeMode) {
  return themeMode === "dark"
    ? "rgba(229, 227, 219, 0.92)"
    : "rgba(100, 98, 90, 0.84)";
}

function getTickFill(themeMode: UiThemeMode) {
  return themeMode === "dark"
    ? "rgba(150, 148, 140, 0.65)"
    : "rgba(130, 128, 120, 0.78)";
}

function getGuideStroke(themeMode: UiThemeMode) {
  return themeMode === "dark"
    ? "rgba(229, 227, 219, 0.5)"
    : "rgba(26, 26, 26, 0.3)";
}

function getMarkerFill(themeMode: UiThemeMode) {
  return themeMode === "dark" ? "#E5E3DB" : "#1A1A1A";
}

function getBaselineStroke(themeMode: UiThemeMode) {
  return themeMode === "dark"
    ? "rgba(180, 178, 168, 0.22)"
    : "rgba(100, 98, 90, 0.16)";
}

function buildTrendPoints(
  totalDays: number,
  width: number,
  dayCounts: number[],
  maxCount: number,
  chartTop: number,
  chartHeight: number
) {
  const chartLeft = timelineToPixel(0, totalDays, width);
  const chartRight = timelineToPixel(totalDays, totalDays, width);
  const chartBottom = chartTop + chartHeight;
  const points: Point[] = [{ x: chartLeft, y: chartBottom }];

  for (let day = 1; day <= totalDays; day += 1) {
    points.push({
      x: timelineToPixel(day, totalDays, width),
      y: getTrendPointY(dayCounts[day] ?? 0, maxCount, chartTop, chartHeight),
    });
  }

  return { chartRight, points };
}

function traceLine(context: CanvasRenderingContext2D, points: Point[]) {
  if (points.length === 0) return;

  context.moveTo(points[0].x, points[0].y);

  if (points.length === 1) {
    context.lineTo(points[0].x, points[0].y);
    return;
  }

  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    context.lineTo(current.x, current.y);
  }
}

function drawArea(
  context: CanvasRenderingContext2D,
  points: Point[],
  baselineY: number,
  fillStyle: string
) {
  if (points.length === 0) return;

  context.beginPath();
  context.moveTo(points[0].x, baselineY);
  context.lineTo(points[0].x, points[0].y);
  traceLine(context, points);
  context.lineTo(points[points.length - 1].x, baselineY);
  context.closePath();
  context.fillStyle = fillStyle;
  context.fill();
}

function drawLine(
  context: CanvasRenderingContext2D,
  points: Point[],
  strokeStyle: string,
  lineWidth: number
) {
  if (points.length === 0) return;

  context.beginPath();
  traceLine(context, points);
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.stroke();
}

function getMarkerY(points: Point[], markerX: number) {
  if (points.length === 0) return 0;
  if (markerX <= points[0].x) return points[0].y;
  if (markerX >= points[points.length - 1].x) return points[points.length - 1].y;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (markerX > current.x) continue;

    const segmentWidth = current.x - previous.x || 1;
    const progress = (markerX - previous.x) / segmentWidth;
    return previous.y + (current.y - previous.y) * progress;
  }

  return points[points.length - 1].y;
}

function drawDataPoints(
  context: CanvasRenderingContext2D,
  points: Point[],
  strokeStyle: string,
  fillStyle: string
) {
  if (points.length <= 1) return;

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    context.beginPath();
    context.arc(point.x, point.y, 2.25, 0, Math.PI * 2);
    context.fillStyle = fillStyle;
    context.fill();
    context.strokeStyle = strokeStyle;
    context.lineWidth = 1;
    context.stroke();
  }
}

export function TimeBar({
  totalDays,
  dayCounts,
  currentDay,
  themeMode = "light",
  onChange,
  onScrubStart,
  onScrubEnd,
  ariaLabel,
}: TimeBarProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const [width, setWidth] = useState(0);

  const maxCount = useMemo(
    () => Math.max(1, ...dayCounts.slice(1, totalDays + 1)),
    [dayCounts, totalDays]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? canvas.clientWidth;
      setWidth(nextWidth);
    });

    observer.observe(canvas);
    setWidth(canvas.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(TIMEBAR_HEIGHT * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${TIMEBAR_HEIGHT}px`;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, TIMEBAR_HEIGHT);

    if (totalDays <= 0) return;

    const { chartTop, chartHeight, chartBottom, tickY } = getTimebarMetrics(width, totalDays);
    const { chartRight, points } = buildTrendPoints(
      totalDays,
      width,
      dayCounts,
      maxCount,
      chartTop,
      chartHeight
    );

    context.beginPath();
    context.moveTo(TIMEBAR_HORIZONTAL_PADDING, chartBottom);
    context.lineTo(chartRight, chartBottom);
    context.strokeStyle = getBaselineStroke(themeMode);
    context.lineWidth = 1;
    context.stroke();

    drawArea(context, points, chartBottom, getFutureAreaFill(themeMode));

    const markerX = timelineToPixel(currentDay, totalDays, width);
    const markerY = getMarkerY(points, markerX);

    if (markerX > TIMEBAR_HORIZONTAL_PADDING) {
      context.save();
      context.beginPath();
      context.rect(
        TIMEBAR_HORIZONTAL_PADDING,
        0,
        markerX - TIMEBAR_HORIZONTAL_PADDING,
        TIMEBAR_HEIGHT
      );
      context.clip();
      drawArea(context, points, chartBottom, getActiveAreaFill(themeMode));
      context.restore();
    }

    drawLine(context, points, getFutureLineStroke(themeMode), 1.4);
    drawDataPoints(
      context,
      points,
      getFutureLineStroke(themeMode),
      themeMode === "dark" ? "rgba(180, 178, 168, 0.9)" : "rgba(100, 98, 90, 0.92)"
    );

    if (markerX > TIMEBAR_HORIZONTAL_PADDING) {
      context.save();
      context.beginPath();
      context.rect(
        TIMEBAR_HORIZONTAL_PADDING,
        0,
        markerX - TIMEBAR_HORIZONTAL_PADDING,
        TIMEBAR_HEIGHT
      );
      context.clip();
      drawLine(context, points, getActiveLineStroke(themeMode), 2);
      drawDataPoints(
        context,
        points,
        getActiveLineStroke(themeMode),
        themeMode === "dark" ? "#E5E3DB" : "#1A1A1A"
      );
      context.restore();
    }

    context.beginPath();
    context.moveTo(markerX, chartTop - 2);
    context.lineTo(markerX, chartBottom);
    context.strokeStyle = getGuideStroke(themeMode);
    context.lineWidth = 1;
    context.stroke();

    context.fillStyle = getMarkerFill(themeMode);
    context.beginPath();
    context.arc(markerX, markerY, 5.5, 0, Math.PI * 2);
    context.fill();

    if (width >= 240) {
      context.font = `10px ${GRAPH_FONT_FAMILY}`;
      context.textAlign = "center";
      context.fillStyle = getTickFill(themeMode);

      let previousTickX = -Infinity;
      for (let day = 7; day <= totalDays; day += 7) {
        const tickX = timelineToPixel(day, totalDays, width);
        if (tickX - previousTickX < 28) continue;
        context.fillText(String(day), tickX, tickY);
        previousTickX = tickX;
      }
    }
  }, [currentDay, dayCounts, maxCount, themeMode, totalDays, width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateFromPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const nextDay = pixelToDay(event.clientX - rect.left, totalDays, rect.width);
      onChange(nextDay);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      updateFromPointer(event);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      updateFromPointer(event);
      onScrubEnd?.();
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      draggingRef.current = true;
      onScrubStart?.();
      canvas.setPointerCapture(event.pointerId);
      updateFromPointer(event);
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [onChange, onScrubEnd, onScrubStart, totalDays]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={ariaLabel ?? "Conversation trend scrubber"}
      className="block h-[56px] w-full cursor-crosshair"
      style={{ touchAction: "none" }}
    />
  );
}
