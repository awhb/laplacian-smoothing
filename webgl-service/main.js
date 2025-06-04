'use strict';

async function main() {

    /** Define Vertex and Fragment shaders */
    const vsSource = `#version 300 es
        precision highp float;
        precision highp usampler2D;

        layout(location = 0) in uint a_span;
        layout(location = 1) in uint a_offset;
        layout(location = 2) in vec3 a_position;

        uniform usampler2D u_neighbors;   // neighbors[] flat array (R32UI)
        uniform sampler2D u_positions;    // vertex positions texture (RGB32F)

        // Texture size (in texels) of u_neighbors and u_positions
        uniform ivec2 u_neighborTexSize;
        uniform ivec2 u_positionTexSize;

        out vec3 v_newPosition;

        void main() {
            if (a_span == uint(0)) {
                // No neighbors; keep original position
                v_newPosition = a_position;
                return;
            }

            vec3 avg = vec3(0.0);
            for (uint i = 0u; i < a_span; ++i) {
                uint flatIndex = a_offset + i;

                // === Fetch neighbor index ===
                ivec2 neighborCoord = ivec2(
                    int(flatIndex % uint(u_neighborTexSize.x)),
                    int(flatIndex / uint(u_neighborTexSize.x))
                );
                uint neighborIdx = texelFetch(u_neighbors, neighborCoord, 0).r;

                // === Fetch neighbor position ===
                ivec2 posCoord = ivec2(
                    int(neighborIdx % uint(u_positionTexSize.x)),
                    int(neighborIdx / uint(u_positionTexSize.x))
                );
                vec3 neighborPos = texelFetch(u_positions, posCoord, 0).rgb;

                avg += neighborPos;
            }

            avg /= float(a_span);
            v_newPosition = avg;
        }
    `;

    const fsSource = `#version 300 es
        precision mediump float;
        void main() {
        }
    `;

    // Get WebGL context
    /** @type {HTMLCanvasElement} */
    const canvas = document.getElementById("glCanvas");
    const gl = canvas.getContext('webgl2', {antialias: false});
    
    // Check WebGL2
    if (!gl) {
        document.querySelector('.no-webgl2').style.display = 'block';
    }

    const smoothMeshProgram = GLSLProgram.createProgram(
        gl, vsSource, fsSource, ['v_newPosition'], {bufferMode: gl.INTERLEAVED_ATTRIBS} 
    );

    // Resize canvas to match display size
    webglUtils.resizeCanvasToDisplaySize(gl.canvas);

    document.getElementById("objInput").addEventListener("change", async (e) => {
        /** Load from OBJ file input */
        const file = e.target.files[0];
        const text = await file.text();
        const { vertices, faces } = meshHandler.loadFromOBJ(text);
        
        numVertices = vertices.length / 3; 
        numFaces = faces.length / 3;
        console.log(`Mesh loaded: ${numVertices} vertices, ${numFaces} faces.`);

        const { flatNeighbors, offsets, spans } = meshHandler.calculateVertexAdjacencies(vertices, faces);

        numNeighbors = flatNeighbors.length;
        console.log(`Adjacency calculated: ${numNeighbors} total neighbor links.`);

        // TBD
    });


}

window.onload = main;
