(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['exports'], factory);
    } else if (typeof exports === 'object' && typeof exports.nodeName !== 'string') {
        // CommonJS
        factory(exports);
    } else {
        // Browser globals
        factory((root.meshHandler = {}));
    }
}(typeof self !== 'undefined' ? self : this, function (exports) {
    'use strict';
    
    /** @module meshHandler */

    exports.loadFromOBJ = function (objString) {
        const rawVertices = []; // Store [x,y,z]
        const rawFaces = [];    // Store [v0,v1,v2] (0-indexed)

        const lines = objString.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('#') || line.length === 0) {
                continue;
            }

            const parts = line.split(/\s+/);
            const type = parts[0];

            if (type === 'v') {
                rawVertices.push(parseFloat(parts[1]));
                rawVertices.push(parseFloat(parts[2]));
                rawVertices.push(parseFloat(parts[3]));
            } else if (type === 'f') {
                const faceIndices = [];
                for (let i = 1; i < parts.length; i++) {
                    // OBJ indices are 1-based. Also, handles "v/vt/vn" by taking only "v"
                    faceIndices.push(parseInt(parts[i].split('/')[0], 10) - 1);
                }

                // Triangulate if polygon has more than 3 vertices (simple fan triangulation)
                if (faceIndices.length > 3) {
                    const v0 = faceIndices[0];
                    for (let i = 1; i < faceIndices.length - 1; i++) {
                        rawFaces.push(v0);
                        rawFaces.push(faceIndices[i]);
                        rawFaces.push(faceIndices[i + 1]);
                    }
                } else if (faceIndices.length === 3) {
                    rawFaces.push(faceIndices[0]);
                    rawFaces.push(faceIndices[1]);
                    rawFaces.push(faceIndices[2]);
                }
            }
        }
        return {
            vertices: new Float32Array(rawVertices),
            faces: new Uint32Array(rawFaces)
        };
    }

    exports.calculateVertexAdjacencies = function (vertices, faces) {

        const numVertices = vertices.length / 3; 
        
        // Step 1: Read faces to store vertex neighbors for each vertex
        const adjSets = Array(numVertices).fill(null).map(() => new Set());
        for (let i = 0; i < faces.length; i += 3) {
            const v0 = faces[i];
            const v1 = faces[i + 1];
            const v2 = faces[i + 2];

            adjSets[v0].add(v1).add(v2);
            adjSets[v1].add(v0).add(v2);
            adjSets[v2].add(v0).add(v1);
        }

        // Step 2: Compute total number of neighbour entries, then adjacency 
        // information for buffers
        const spans = new Uint32Array(numVertices);
        const offsets = new Uint32Array(numVertices);
        let totalNeighbors = 0;
        for (let i = 0; i < numVertices; i++) {
            spans[i] = adjSets[i].size;
            totalNeighbors += spans[i];
        }

        const flatNeighbors = new Uint32Array(totalNeighbors);
        let currentIndex = 0;
        for (let i = 0; i < numVertices; i++) {
            offsets[i] = currentIndex;
            for (const neighbor of adjSets[i]) {
                flatNeighbors[currentIndex++] = neighbor;
            }
        }

        return { flatNeighbors, offsets, spans };

    }

    exports.generateOBJString = function (numVertices, numFaces, smoothedVertices, faces) {
        if (!faces || !smoothedVertices) {
            return "";
        }
        let objStr = "# Smoothed Mesh Output\n";
        for (let i = 0; i < numVertices; i++) {
            objStr += `v ${smoothedVertices[i * 3]} ${smoothedVertices[i * 3 + 1]} ${smoothedVertices[i * 3 + 2]}\n`;
        }
        objStr += "\n";
        for (let i = 0; i < numFaces; i++) {
            // OBJ indices are 1-based
            objStr += `f ${faces[i * 3] + 1} ${faces[i * 3 + 1] + 1} ${faces[i * 3 + 2] + 1}\n`;
        }
        return objStr;
    }

}));