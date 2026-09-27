import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { AreaHotspot } from '../api/types'

interface GeographicHotspotMapProps {
  district: string
  areas: AreaHotspot[]
  timeRange: string
  onTimeRangeChange: (range: string) => void
  onRefresh: () => void
  isRefreshing?: boolean
  lastUpdated?: string
}

export function GeographicHotspotMap({
  district,
  areas,
  timeRange,
  onTimeRangeChange,
  onRefresh,
  isRefreshing = false,
  lastUpdated,
}: GeographicHotspotMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const baseTileLayerRef = useRef<L.TileLayer | null>(null)
  const geojsonLayersRef = useRef<L.LayerGroup | null>(null)
  const [selectedAreaId, setSelectedAreaId] = useState<string>('AREA_A')
  const [mapStyle, setMapStyle] = useState<'streets-v2' | 'dataviz-light'>('streets-v2')

  // Retrieve MapTiler API Key from Vite environment variable
  const mapTilerKey = import.meta.env.VITE_MAPTILER_API_KEY || ''

  // Find currently selected area or fallback to Area A
  const selectedArea = areas.find((a) => a.area_id === selectedAreaId) || areas[0]

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return
    if (mapInstanceRef.current) return

    // Center coordinates for Central District (Sadar, Danapur, Bikram)
    const map = L.map(mapContainerRef.current, {
      center: [25.602, 85.142],
      zoom: 11.5,
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
    })

    const layerGroup = L.layerGroup().addTo(map)
    geojsonLayersRef.current = layerGroup
    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
      baseTileLayerRef.current = null
      geojsonLayersRef.current = null
    }
  }, [])

  // Update Base Tile Layer dynamically (MapTiler HD / Fallback)
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    if (baseTileLayerRef.current) {
      map.removeLayer(baseTileLayerRef.current)
      baseTileLayerRef.current = null
    }

    if (mapTilerKey) {
      const isRetina = typeof window !== 'undefined' && (window.devicePixelRatio > 1 || (L.Browser && L.Browser.retina))
      // MapTiler tile layer with 512px retina tiles for optimal sharpness
      const tileUrl = isRetina
        ? `https://api.maptiler.com/maps/${mapStyle}/{z}/{x}/{y}@2x.png?key=${mapTilerKey}`
        : `https://api.maptiler.com/maps/${mapStyle}/{z}/{x}/{y}.png?key=${mapTilerKey}`

      const tileLayer = L.tileLayer(tileUrl, {
        tileSize: 512,
        zoomOffset: -1,
        minZoom: 1,
        maxZoom: 19,
        crossOrigin: true,
        attribution:
          '\u003ca href="https://www.maptiler.com/copyright/" target="_blank"\u003e\u0026copy; MapTiler\u003c/a\u003e \u003ca href="https://www.openstreetmap.org/copyright" target="_blank"\u003e\u0026copy; OpenStreetMap contributors\u003c/a\u003e',
      }).addTo(map)

      baseTileLayerRef.current = tileLayer
    } else {
      // Clean fallback if key is not configured
      const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; CartoDB',
      }).addTo(map)

      baseTileLayerRef.current = tileLayer
    }
  }, [mapStyle, mapTilerKey])

  // Update GeoJSON Layers & Hotspot styling when areas change
  useEffect(() => {
    const map = mapInstanceRef.current
    const layerGroup = geojsonLayersRef.current
    if (!map || !layerGroup) return

    layerGroup.clearLayers()

    areas.forEach((area) => {
      const isHigh = area.hotspot_level === 'HIGH' || area.intensity >= 0.70
      const isModerate = area.hotspot_level === 'MODERATE' || (area.intensity >= 0.40 && area.intensity < 0.70)
      const isSelected = area.area_id === selectedAreaId

      // Dynamic color tokens based on backend-calculated intensity
      const fillColor = isHigh ? '#EF4444' : isModerate ? '#F59E0B' : '#10B981'
      const borderColor = isHigh ? '#B91C1C' : isModerate ? '#D97706' : '#059669'
      const fillOpacity = isHigh ? 0.48 : isModerate ? 0.32 : 0.20
      const strokeWidth = isSelected ? 3.5 : isHigh ? 2.5 : 1.8

      // GeoJSON Polygon
      if (area.geojson) {
        const polygonLayer = L.geoJSON(area.geojson, {
          style: {
            fillColor,
            fillOpacity,
            color: borderColor,
            weight: strokeWidth,
            dashArray: isSelected ? undefined : undefined,
          },
        })

        // Tooltip: aggregated metrics only (strictly zero PII)
        const tooltipHtml = `
          <div style="font-family: 'Inter', system-ui, sans-serif; padding: 6px 4px; min-width: 175px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-weight: 700; font-size: 13px; color: #0b1c30;">${area.area_name}</span>
              <span style="font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: ${
                isHigh ? '#ffdad6' : isModerate ? '#fef3c7' : '#dcfce7'
              }; color: ${isHigh ? '#ba1a1a' : isModerate ? '#b45309' : '#15803d'};">
                ${area.hotspot_level}
              </span>
            </div>
            <div style="font-size: 11px; color: #565e74; margin-bottom: 8px;">
              ${area.administrative_name} · ${area.district}
            </div>
            <div style="border-top: 1px solid #e5eeff; padding-top: 6px; font-size: 12px; display: flex; flex-direction: column; gap: 3px;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #565e74;">Active Cases:</span>
                <span style="font-weight: 600; color: #0b1c30;">${area.active_cases}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #565e74;">Average Distress:</span>
                <span style="font-weight: 700; color: ${isHigh ? '#ba1a1a' : '#3525cd'};">${area.average_distress.toFixed(1)} / 100</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #565e74;">High/Critical:</span>
                <span style="font-weight: 600; color: ${area.high_risk_cases > 0 ? '#ba1a1a' : '#565e74'};">${area.high_risk_cases}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #565e74;">Recent Change:</span>
                <span style="font-weight: 600; color: ${area.recent_change_pct > 0 ? '#ba1a1a' : '#15803d'};">
                  ${area.recent_change_pct > 0 ? '+' : ''}${area.recent_change_pct.toFixed(1)}%
                </span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #565e74;">Trend:</span>
                <span style="font-weight: 600; text-transform: capitalize; color: #0b1c30;">${area.trend.toLowerCase()}</span>
              </div>
            </div>
          </div>
        `

        polygonLayer.bindTooltip(tooltipHtml, {
          sticky: true,
          direction: 'auto',
          className: 'viora-map-tooltip',
        })

        // Click handler to select area
        polygonLayer.on('click', () => {
          setSelectedAreaId(area.area_id)
        })

        // Hover highlight
        polygonLayer.on('mouseover', (e) => {
          const l = e.target
          l.setStyle({ fillOpacity: Math.min(0.75, fillOpacity + 0.15), weight: strokeWidth + 1.5 })
        })
        polygonLayer.on('mouseout', (e) => {
          const l = e.target
          l.setStyle({ fillOpacity, weight: strokeWidth })
        })

        layerGroup.addLayer(polygonLayer)
      }

      // Centroid marker badge
      if (area.center_lat && area.center_lng) {
        // Outer pulsing ring for HIGH hotspot
        if (isHigh) {
          const pulseIcon = L.divIcon({
            className: 'hotspot-pulse-container',
            html: `
              <div class="relative flex items-center justify-center w-8 h-8">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-error opacity-60"></span>
                <span class="relative inline-flex rounded-full h-4 w-4 bg-error border-2 border-white shadow-md"></span>
              </div>
            `,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          })
          const pulseMarker = L.marker([area.center_lat, area.center_lng], { icon: pulseIcon })
          pulseMarker.on('click', () => setSelectedAreaId(area.area_id))
          layerGroup.addLayer(pulseMarker)
        } else {
          // Standard center dot
          const dot = L.circleMarker([area.center_lat, area.center_lng], {
            radius: isModerate ? 6 : 5,
            fillColor,
            fillOpacity: 0.9,
            color: '#FFFFFF',
            weight: 2,
          })
          dot.on('click', () => setSelectedAreaId(area.area_id))
          layerGroup.addLayer(dot)
        }
      }
    })
  }, [areas, selectedAreaId])

  return (
    <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-surface-container flex flex-col justify-between h-full">
      {/* Header & Controls */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm mb-space-xs">
          <div>
            <div className="flex items-center gap-space-xs">
              <span className="font-headline-sm text-headline-sm text-on-surface font-bold">
                Geographic Distress Hotspots
              </span>
              <span className="flex items-center gap-1 px-space-xs py-0.5 rounded-full bg-primary-fixed font-label-sm text-[10px] text-on-primary-fixed uppercase tracking-wider font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                Live
              </span>
              {mapTilerKey && (
                <span
                  title="Powered by MapTiler Cloud (512px High-DPI tiles)"
                  className="hidden sm:inline-flex items-center gap-1 px-space-xs py-0.5 rounded-md bg-surface-container font-label-sm text-[10px] text-secondary font-medium"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  MapTiler HD
                </span>
              )}
            </div>
            <p className="font-body-sm text-body-sm text-secondary mt-1">
              Where is distress concentrated across {district}?
            </p>
          </div>

          {/* Style selection, Time range pills & Refresh */}
          <div className="flex flex-wrap items-center gap-space-xs self-start sm:self-auto">
            {mapTilerKey && (
              <div className="inline-flex rounded-lg p-0.5 bg-surface-container">
                <button
                  type="button"
                  onClick={() => setMapStyle('streets-v2')}
                  title="MapTiler Streets view (places, roads, landmarks)"
                  className={`px-space-xs py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                    mapStyle === 'streets-v2'
                      ? 'bg-surface-container-lowest text-primary shadow-xs'
                      : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  Streets
                </button>
                <button
                  type="button"
                  onClick={() => setMapStyle('dataviz-light')}
                  title="MapTiler Dataviz view (clean data visualization)"
                  className={`px-space-xs py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                    mapStyle === 'dataviz-light'
                      ? 'bg-surface-container-lowest text-primary shadow-xs'
                      : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  Dataviz
                </button>
              </div>
            )}

            <div className="inline-flex rounded-lg p-0.5 bg-surface-container">
              {[
                { id: 'today', label: 'Today' },
                { id: '7d', label: '7 Days' },
                { id: '30d', label: '30 Days' },
              ].map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => onTimeRangeChange(btn.id)}
                  className={`px-space-sm py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                    timeRange === btn.id
                      ? 'bg-surface-container-lowest text-primary shadow-xs'
                      : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh geographic aggregation from database"
              className="p-1.5 rounded-lg bg-surface-container text-secondary hover:text-primary hover:bg-surface-container-high transition-colors cursor-pointer flex items-center justify-center disabled:opacity-50"
            >
              <span
                className={`material-symbols-outlined text-[18px] ${
                  isRefreshing ? 'animate-spin text-primary' : ''
                }`}
              >
                refresh
              </span>
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-between py-space-xs text-xs font-label-sm text-secondary gap-space-xs">
          <div className="flex items-center gap-space-md">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#10B981] inline-block"></span>
              Low (&lt;40)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#F59E0B] inline-block"></span>
              Moderate (40-69)
            </span>
            <span className="flex items-center gap-1.5 font-semibold text-on-surface">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#EF4444] animate-pulse inline-block"></span>
              High Hotspot (≥70)
            </span>
          </div>
          <span className="text-[11px] text-secondary">
            Hover area for aggregate telemetry
          </span>
        </div>
      </div>

      {/* Map Container */}
      <div className="relative w-full h-56 my-space-sm rounded-lg overflow-hidden border border-surface-container bg-surface-container-low">
        <div ref={mapContainerRef} className="w-full h-full" style={{ zIndex: 10 }} />

        {/* Floating live indicator */}
        <div
          className="absolute top-2 right-2 bg-surface-container-lowest/90 backdrop-blur-md px-2 py-1 rounded-md text-[10px] font-data-mono font-medium text-secondary shadow-xs border border-surface-container pointer-events-none"
          style={{ zIndex: 1000 }}
        >
          {lastUpdated ? `Sync: ${lastUpdated}` : 'Live Database Sync'}
        </div>
      </div>

      {/* Selected Area Interactive Drawer / Bottom Card */}
      {selectedArea && (
        <div className="pt-space-xs border-t border-surface-container">
          <div className="flex flex-wrap items-center justify-between gap-space-sm p-space-sm rounded-lg bg-surface-container-low/60 border border-surface-container">
            <div className="flex items-center gap-space-sm">
              <div
                className={`w-3 h-3 rounded-full shrink-0 ${
                  selectedArea.hotspot_level === 'HIGH'
                    ? 'bg-error animate-ping'
                    : selectedArea.hotspot_level === 'MODERATE'
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
              />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-label-md text-label-md font-bold text-on-surface">
                    {selectedArea.area_name}
                  </span>
                  <span className="text-xs text-secondary">
                    ({selectedArea.administrative_name})
                  </span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                      selectedArea.hotspot_level === 'HIGH'
                        ? 'bg-error-container text-on-error-container'
                        : selectedArea.hotspot_level === 'MODERATE'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-emerald-100 text-emerald-900'
                    }`}
                  >
                    {selectedArea.hotspot_level} CONCENTRATION
                  </span>
                </div>
                <div className="text-xs text-secondary mt-0.5">
                  {selectedArea.active_cases} Active Cases · {selectedArea.high_risk_cases} High Risk
                </div>
              </div>
            </div>

            <div className="flex items-center gap-space-lg text-right">
              <div>
                <span className="text-[10px] uppercase font-semibold text-secondary block">
                  Avg Distress
                </span>
                <span
                  className={`font-data-mono font-bold text-sm ${
                    selectedArea.hotspot_level === 'HIGH' ? 'text-error' : 'text-primary'
                  }`}
                >
                  {selectedArea.average_distress.toFixed(1)} / 100
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-secondary block">
                  Hotspot Score
                </span>
                <span className="font-data-mono font-bold text-sm text-on-surface">
                  {selectedArea.hotspot_score.toFixed(1)}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-secondary block">
                  Trend
                </span>
                <span
                  className={`text-xs font-semibold ${
                    selectedArea.trend === 'INCREASING'
                      ? 'text-error'
                      : selectedArea.trend === 'DECREASING'
                      ? 'text-emerald-600'
                      : 'text-secondary'
                  }`}
                >
                  {selectedArea.trend === 'INCREASING' ? '↑ Increasing' : selectedArea.trend === 'DECREASING' ? '↓ Decreasing' : '→ Stable'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
