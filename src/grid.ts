import { round6 } from "./util.js";

const KM_PER_DEG_LAT = 110.574;
const kmPerDegLng = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

export interface Cell {
  lat: number;
  lng: number;
}

/** bbox = [minLat, minLng, maxLat, maxLng] */
export function cellsForBbox(
  bbox: [number, number, number, number],
  cellKm: number,
): Cell[] {
  const [minLat, minLng, maxLat, maxLng] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const latStep = cellKm / KM_PER_DEG_LAT;
  const lngStep = cellKm / kmPerDegLng(midLat);

  const out: Cell[] = [];
  for (let lat = minLat + latStep / 2; lat < maxLat; lat += latStep) {
    for (let lng = minLng + lngStep / 2; lng < maxLng; lng += lngStep) {
      out.push({ lat: round6(lat), lng: round6(lng) });
    }
  }
  return out;
}

/**
 * Four child cells covering the same area at half the linear size.
 * `parentDepth` is the depth of the cell being split (children get parentDepth + 1).
 */
export function subdivide(
  parent: Cell,
  parentDepth: number,
  baseCellKm: number,
): Cell[] {
  const childKm = baseCellKm / 2 ** (parentDepth + 1);
  const dLat = childKm / 2 / KM_PER_DEG_LAT;
  const dLng = childKm / 2 / kmPerDegLng(parent.lat);
  const out: Cell[] = [];
  for (const sLat of [-1, 1]) {
    for (const sLng of [-1, 1]) {
      out.push({
        lat: round6(parent.lat + sLat * dLat),
        lng: round6(parent.lng + sLng * dLng),
      });
    }
  }
  return out;
}

export function cellId(district: string, keyword: string, c: Cell, depth: number): string {
  return `${district}::${keyword}::${c.lat.toFixed(5)}::${c.lng.toFixed(5)}::${depth}`;
}
