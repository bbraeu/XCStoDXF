import { parsePathToPolylines, getOperationFor, buildDxf } from "./dxf.js";

let aExcludeLog = [],
    iStroke = 0.6;

let getTransform = (o, bPos = true, bRotate = true, bScale = true) => {
    let s = "";

    if (bScale) {
        s = `scale(${o.scale.x}, ${o.scale.y})`
    }

    if (o.angle && bRotate) {
        let x = o.x,
            y = o.y;

        s += ` rotate(${o.angle},  ${x}, ${y})`;
    }

    if (bPos) {
        s = `translate(${o.x}, ${o.y}) ` + s;
    }

    return s;
};

let getId = o => {
    if (import.meta.env.DEV) {
        return `id="${o.id}" `;
    }
    return "";
};

// Preview colour for a shape, derived from its operation type (set on the display
// as _opColor by processCanvas). Falls back to black for anything untyped.
let getColor = o => o._opColor || "black";

let getFill = o => {
    let c = getColor(o);
    if (o.isFill) {
        // Honour the shape's fill rule so compound paths keep their holes
        // (evenodd); without it the default nonzero rule fills them solid.
        return `fill="${c}" fill-rule="${o.fillRule || "nonzero"}"`;
    } else {
        return `fill="transparent" stroke="${c}"`;
    }
}

// Local transform matrix [a,b,c,d] from a display's rotation, skew and scale,
// using the same composition as xTool's editor (PIXI-style). This is what makes
// skew.x === π render as a vertical flip (d = cos(-π)*scaleY = -scaleY); the old
// code ignored skew, so such shapes came out upside-down.
let getMatrix = o => {
    let sx = o.scale?.x ?? 1,
        sy = o.scale?.y ?? 1,
        rot = (o.angle || 0) * Math.PI / 180, // angle is stored in degrees
        skX = o.skew?.x || 0,                 // skew is stored in radians
        skY = o.skew?.y || 0;
    return [
        Math.cos(rot + skY) * sx,
        Math.sin(rot + skY) * sx,
        -Math.sin(rot - skX) * sy,
        Math.cos(rot - skX) * sy
    ];
};

const convert = {
    PATH: o => {
        let [a, b, c, d] = getMatrix(o);
        return `<path ${getId(o)}d="${o.dPath}" ${getFill(o)} transform="matrix(${a}, ${b}, ${c}, ${d}, ${o.graphicX}, ${o.graphicY})" stroke-width="${iStroke}"/>`;
    },
    RECT: o => {
        return `<rect id="${o.id}" width="${o.width}" height="${o.height}" x="${o.x}" y="${o.y}" ${getFill(o)} transform="${getTransform(o, false, true, false)}" stroke-width="${iStroke}"/>`;
    },
    CIRCLE: o => {
        return `<ellipse ${getId(o)} rx="${o.width / 2}" ry="${o.height / 2}" transform="${getTransform(o, false, true, false)} translate(${o.x + (o.width / 2)}, ${o.y + (o.height / 2)})" ${getFill(o)} stroke-width="${iStroke}"/>`;
    },
    POLYGON: o => {
        return `<polygon ${getId(o)}points="${o.points}" ${getFill(o)} transform="${getTransform(o)}" stroke-width="${iStroke}"/>`;
    },
    LINE: o => {
        return `<line ${getId(o)} x1="${o.x}" y1="${o.y}" x2="${o.x + o.endPoint.x}" y2="${o.y + o.endPoint.y}" stroke="${getColor(o)}" transform="${getTransform(o, false)}" stroke-width="${iStroke}"/>`;
    },
    TEXT: o => {
        if (o.charJSONs) {
            return o.charJSONs.map(c => {
                c.x = c.graphicX;
                c.y = c.graphicY;
                c._opColor = o._opColor;
                return convert.PATH(c);
            }).join("");
        } else {
            // This mode would rather be only for generated files
            let aStyle = [],
                oStyle = o.style;

            if (oStyle.fontFamily) {
                aStyle.push(`font-family: ${oStyle.fontFamily}`);
            }
            if (oStyle.fontSize) { // 0.359 is a magic number which seems to bring the scale just right
                aStyle.push(`font-size: ${oStyle.fontSize * 0.2818}pt`);
            }
            return `<text ${getId(o)} transform="${getTransform(o, false)}" dominant-baseline="mathematical" x="${o.x}" y="${o.y}" style="${aStyle.join(";")}">${o.text}</text>`;
        }
    },
    PEN: o => {
        let a = [];

        o.points.forEach((c, i) => {
            if (i === 0) {
                a.push(`M ${c.x} ${c.y}`);
                return;
            }
            let aCp = o.controlPoints[i];
            if (aCp) {
                a.push(`S ${aCp[0].x} ${aCp[0].y} ${c.x} ${c.y}`);
            } else {
                let aPrev = o.controlPoints[i - 1];
                if (aPrev) {
                    a.push(`Q ${aPrev[1].x} ${aPrev[1].y} ${c.x} ${c.y}`);
                } else {
                    a.push(`L ${c.x} ${c.y}`);
                }
            }
        });

        let oLast = o.controlPoints[o.points.length - 1];
        if (oLast) {
            a.push(`Q ${oLast[1].x} ${oLast[1].y} ${o.points[0].x} ${o.points[0].y}`);
        }

        return `<path ${getId(o)}d="${a.join(' ')}" ${getFill(o)} transform="${getTransform(o, false)}" stroke-width="${iStroke}"/>`;
    },
    BITMAP: o => {
        return `<image ${getId(o)}href="${o.base64}" x="${o.x}" y="${o.y}" height="${o.width}" width="${o.height}" transform="${getTransform(o, false, true, false)}" />`;
    }
};

let processCanvas = (oJSON, oCanvas) => {
    let aOutput = [],
        oPTMap = getProcessingTypeMap(oJSON, oCanvas),
        bBig = oJSON?.device?.data?.value.find(a => a[0] === oCanvas.id)[1]?.mode === "SUPER_LASER_PLANE";

    // Process displays, colouring each by its operation type so the preview shows
    // surface engraving / line engraving / cutting the same way the DXF does.
    oCanvas.displays.forEach(oDisplay => {
        let fnConvert = convert[oDisplay.type];
        if (fnConvert) {
            oDisplay._opColor = getOperationFor(oPTMap.get(oDisplay.id)).css;
            aOutput.push(fnConvert(oDisplay));
        } else {
            aExcludeLog.push(oDisplay.type);
        }
    });

    return {
        big: bBig,
        title: oCanvas.title.replace("{panel}", "Canvas "),
        svg: `<svg viewBox="0 0 430 ${bBig ? 930 : 390}" xmlns="http://www.w3.org/2000/svg">
                ${aOutput.join("")}
              </svg>`
    };
}

let toSVG = (oJSON) => {
    return {
        aCanvas: oJSON.canvas.map(processCanvas.bind(this, oJSON)),
        aExcluded: aExcludeLog
    };
};

// ---------------------------------------------------------------------------
// DXF conversion
//
// The operation type (surface engraving / line engraving / line cutting) is not
// stored on the geometry. It lives in device.data.value, a serialised Map:
//   [canvasId, { displays: Map<displayId, { processingType, ... }> }]
// We look each display's processingType up there and route its geometry onto a
// dedicated DXF layer (see LAYER_DEFS in dxf.js).
//
// To avoid re-deriving every shape transform, we reuse the existing SVG builders:
// each shape is rendered into an off-screen <svg>, then we read the browser's
// getCTM() to map local coordinates into the canvas (mm) coordinate system, and
// flatten curves to polylines.

// Build displayId -> processingType map for a canvas.
let getProcessingTypeMap = (oJSON, oCanvas) => {
    let map = new Map(),
        aEntry = oJSON?.device?.data?.value?.find(a => a[0] === oCanvas.id),
        aDisplays = aEntry?.[1]?.displays?.value;

    if (Array.isArray(aDisplays)) {
        aDisplays.forEach(([sId, oCfg]) => map.set(sId, oCfg?.processingType));
    }
    return map;
};

// Extract local (pre-transform) polylines from a rendered SVG geometry element.
// Returns [{ points: [{x,y}], closed: bool }].
let getLocalGeometry = el => {
    let f = a => parseFloat(el.getAttribute(a)) || 0,
        tag = el.tagName.toLowerCase();

    switch (tag) {
        case "path":
            return parsePathToPolylines(el.getAttribute("d"));
        case "rect":
        case "image": { // <image> becomes a bounding rectangle (raster can't be vectorised)
            let x = f("x"), y = f("y"), w = f("width"), h = f("height");
            return [{ points: [
                { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }
            ], closed: true }];
        }
        case "ellipse": {
            let rx = f("rx"), ry = f("ry"),
                cx = f("cx"), cy = f("cy"),
                rMax = Math.max(rx, ry),
                segs = Math.max(12, Math.ceil((2 * Math.PI) / (2 * Math.acos(Math.max(0, 1 - 0.01 / rMax))))),
                pts = [];
            for (let i = 0; i < segs; i++) {
                let t = (2 * Math.PI * i) / segs;
                pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
            }
            return [{ points: pts, closed: true }];
        }
        case "line":
            return [{ points: [
                { x: f("x1"), y: f("y1") }, { x: f("x2"), y: f("y2") }
            ], closed: false }];
        case "polygon": {
            let pts = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number),
                out = [];
            for (let i = 0; i + 1 < pts.length; i += 2) out.push({ x: pts[i], y: pts[i + 1] });
            return out.length ? [{ points: out, closed: true }] : [];
        }
        default:
            return [];
    }
};

let processCanvasDXF = (oJSON, oCanvas) => {
    let oPTMap = getProcessingTypeMap(oJSON, oCanvas),
        bBig = oJSON?.device?.data?.value.find(a => a[0] === oCanvas.id)?.[1]?.mode === "SUPER_LASER_PLANE",
        H = bBig ? 930 : 390;

    // Render every shape into a single off-screen SVG, one <g data-idx> per display
    // so we can map each rendered element back to its processingType.
    let aParts = [];
    oCanvas.displays.forEach((oDisplay, i) => {
        let fnConvert = convert[oDisplay.type];
        if (fnConvert) {
            aParts.push(`<g data-idx="${i}">${fnConvert(oDisplay)}</g>`);
        } else {
            aExcludeLog.push(oDisplay.type);
        }
    });

    let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 430 ${H}`);
    svg.setAttribute("width", "430");
    svg.setAttribute("height", String(H));
    svg.style.cssText = "position:absolute;left:-100000px;top:0;opacity:0;pointer-events:none";
    svg.innerHTML = aParts.join("");
    document.body.appendChild(svg);

    let aEntities = [];
    try {
        svg.querySelectorAll("g[data-idx]").forEach(g => {
            let iIdx = parseInt(g.getAttribute("data-idx"), 10),
                oDisplay = oCanvas.displays[iIdx],
                iColor = getOperationFor(oPTMap.get(oDisplay.id)).color;

            g.querySelectorAll("path,rect,ellipse,line,polygon,image").forEach(el => {
                let m = el.getCTM();
                if (!m) return;
                getLocalGeometry(el).forEach(sub => {
                    if (sub.points.length < 2) return;
                    aEntities.push({
                        color: iColor,
                        closed: sub.closed,
                        // Map local coords into canvas (mm) space via the element's CTM.
                        points: sub.points.map(p => ({
                            x: m.a * p.x + m.c * p.y + m.e,
                            y: m.b * p.x + m.d * p.y + m.f
                        }))
                    });
                });
            });
        });
    } finally {
        document.body.removeChild(svg);
    }

    // SVG y grows downward, DXF y grows upward: flip about the bounding box top.
    let maxY = -Infinity;
    aEntities.forEach(e => e.points.forEach(p => { if (p.y > maxY) maxY = p.y; }));
    if (isFinite(maxY)) {
        aEntities.forEach(e => e.points.forEach(p => { p.y = maxY - p.y; }));
    }

    return {
        title: oCanvas.title.replace("{panel}", "Canvas "),
        dxf: buildDxf(aEntities)
    };
};

let toDXF = (oJSON) => {
    return {
        aCanvas: oJSON.canvas.map(processCanvasDXF.bind(this, oJSON)),
        aExcluded: aExcludeLog
    };
};

export default {
    toSVG,
    toDXF
}
