/** Define Vertex and Fragment shaders */
const vsSourcePrior = `#version 300 es
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

const fsSourcePrior = `#version 300 es
    precision mediump float;
    void main() {
    }
`;


const vsSource = `#version 300 es
    precision highp float;
    precision highp int;
    precision highp usampler2D;

    uniform sampler2D u_positionTex;      // Current vertex positions (RGB32F)
    uniform usampler2D u_offsetsSpansTex; // (offset, span) for each vertex (RG32UI)
    uniform usampler2D u_flatNeighborsTex;  // Flattened neighbor indices (R32UI)

    uniform int u_posTexWidth;
    uniform int u_neighborsTexWidth;

    out vec3 v_newPosition;

    ivec2 getTexCoord(int id, int texWidth) {
        return ivec2(id % texWidth, id / texWidth);
    }

    void main() {
        int vertexID = gl_VertexID;
        ivec2 posTexCoord = getTexCoord(vertexID, u_posTexWidth);

        uvec2 offsetSpan = texelFetch(u_offsetsSpansTex, posTexCoord, 0).rg;
        uint offset = offsetSpan.r;
        uint span = offsetSpan.g;

        vec3 currentPos = texelFetch(u_positionTex, posTexCoord, 0).rgb;
        vec3 newPos = currentPos; // Default to current if no neighbors

        if (span > 0u) {
            vec3 sumNeighborPositions = vec3(0.0);
            for (uint i = 0u; i < span; ++i) {
                uint neighborGlobalFlatIndex = offset + i;
                ivec2 neighborIndexTexCoord = getTexCoord(int(neighborGlobalFlatIndex), u_neighborsTexWidth);
                
                uint neighborVertexID = texelFetch(u_flatNeighborsTex, neighborIndexTexCoord, 0).r;

                ivec2 neighborPosTexCoord = getTexCoord(int(neighborVertexID), u_posTexWidth);
                sumNeighborPositions += texelFetch(u_positionTex, neighborPosTexCoord, 0).rgb;
            }
            newPos = sumNeighborPositions / float(span);
        }
        v_newPosition = newPos;
    }`;

const fsSource = `#version 300 es
    precision mediump float;
    out vec4 fragColor;
    void main() {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0); // Not really used with TF + rasterizer discard
    }`;
return { vsSource, fsSource };
