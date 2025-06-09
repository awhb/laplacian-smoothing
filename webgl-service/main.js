'use strict';

async function main() {

    /** Define Vertex and Fragment shaders */
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
        void main() {
        }`;

    // Get WebGL context
    /** @type {HTMLCanvasElement} */
    const canvas = document.getElementById("glCanvas");
    const gl = canvas.getContext('webgl2', {antialias: false});
    
    // Check WebGL2
    if (!gl) {
        document.querySelector('.no-webgl2').style.display = 'block';
    }

    // Resize canvas to match display size
    webglUtils.resizeCanvasToDisplaySize(gl.canvas);

    // Get references to the slider and its value display
    const iterationsSlider = document.getElementById('iterationsSlider');
    const iterationsValueSpan = document.getElementById('iterationsValue');

    // Initialize numIterations from the slider's current value
    let numIterations = parseInt(iterationsSlider.value);
    iterationsValueSpan.textContent = numIterations; // Ensure initial display matches

    // Add an event listener to update numIterations when the slider changes
    iterationsSlider.addEventListener('input', () => {
        numIterations = parseInt(iterationsSlider.value);
        iterationsValueSpan.textContent = numIterations;
        console.log(`Number of iterations set to: ${numIterations}`);
    });


    document.getElementById("objInput").addEventListener("change", async (e) => {
        // Define handles to destroy GPU resources later
        let smoothingProgram = null;
        let transformFeedback = null;
        let vao = null;
        let posFeedbackBufferA = null; 
        let posFeedbackBufferB = null; 
        let tempUnpackBuffer = null;
        let positionTextureA = null;
        let positionTextureB = null;
        let offsetsSpansTexture = null;
        let flatNeighborsTexture = null;

        try {
            /** Load from OBJ file input */
            const file = e.target.files[0];
            const text = await file.text();
            const { vertices, faces } = meshHandler.loadFromOBJ(text);
            
            const numVertices = vertices.length / 3; 
            const numFaces = faces.length / 3;
            console.log(`Mesh loaded: ${numVertices} vertices, ${numFaces} faces.`);

            const { flatNeighbors, offsets, spans } = meshHandler.calculateVertexAdjacencies(vertices, faces);

            const numNeighbors = flatNeighbors.length;
            console.log(`Adjacency calculated: ${numNeighbors} total neighbor links.`);

            // Create GLSL Program
            smoothingProgram = GLSLProgram.createProgram(
                gl, vsSource, fsSource, ['v_newPosition'], {bufferMode: gl.INTERLEAVED_ATTRIBS} 
            );

            // Fetch uniform locations 
            const uniformLocations = {
                positionTex: gl.getUniformLocation(smoothingProgram, "u_positionTex"),
                offsetsSpansTex: gl.getUniformLocation(smoothingProgram, "u_offsetsSpansTex"),
                flatNeighborsTex: gl.getUniformLocation(smoothingProgram, "u_flatNeighborsTex"),
                posTexWidth: gl.getUniformLocation(smoothingProgram, "u_posTexWidth"),
                neighborsTexWidth: gl.getUniformLocation(smoothingProgram, "u_neighborsTexWidth")
            };

            /** Prepare Uniform Textures */
            // Position Textures (RGB32F)
            const posTexInfo = GLSLProgram.calculateTextureSize(gl, numVertices);
            positionTextureA = GLSLProgram.createDataTexture(gl, gl.RGB32F, gl.RGB, gl.FLOAT, posTexInfo, vertices);
            positionTextureB = GLSLProgram.createDataTexture(gl, gl.RGB32F, gl.RGB, gl.FLOAT, posTexInfo, null); // Empty

            // Adjacency Textures (Integer Textures)
            // Offsets and Spans (RG32UI) - combines offsets and spans
            const offsetsSpansData = new Uint32Array(numVertices * 2);
            for (let i = 0; i < numVertices; i++) {
                offsetsSpansData[i * 2 + 0] = offsets[i];
                offsetsSpansData[i * 2 + 1] = spans[i];
            }
            offsetsSpansTexture = GLSLProgram.createDataTexture(gl, gl.RG32UI, gl.RG_INTEGER, gl.UNSIGNED_INT, posTexInfo, offsetsSpansData);

            // Flat Neighbors (R32UI)
            const neighborsTexInfo = GLSLProgram.calculateTextureSize(gl, flatNeighbors.length);
            flatNeighborsTexture = GLSLProgram.createDataTexture(gl, gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, neighborsTexInfo, flatNeighbors);

            /** Prepare Transform Feedback Buffers */
            // Create padded buffer with size that can perfectly map to data texture
            const vertTextureBuffer = new Float32Array(posTexInfo.width * posTexInfo.height * 3);

            // Create Transform Feedback Object
            transformFeedback = gl.createTransformFeedback();

            // Buffers for vertex positions (Transform Feedback targets)
            posFeedbackBufferA = GLSLProgram.createBuffer(gl, vertTextureBuffer, gl.DYNAMIC_COPY);
            posFeedbackBufferB = GLSLProgram.createBuffer(gl, vertTextureBuffer, gl.DYNAMIC_COPY);

            // Pixel unpack buffer for copying to texture
            tempUnpackBuffer = GLSLProgram.createBuffer(gl, vertTextureBuffer, gl.STREAM_READ);

            // Dummy VAO (needed for gl.drawArrays in WebGL 2.0 core profile if no attributes are bound)
            vao = gl.createVertexArray();

            /** Perform smoothing operation */
            if (!smoothingProgram || !vertices) {
                throw new Error("Smoother not initialized or mesh not loaded.");
            }

            console.time(`Smoothing ${numIterations} iterations`);

            let currentPositionTexture = positionTextureA;
            let nextPositionTexture = positionTextureB;
            let currentReadBuffer = posFeedbackBufferA; // Buffer corresponding to positionTextureA
            let currentWriteBuffer = posFeedbackBufferB;


            gl.useProgram(smoothingProgram);
            gl.bindVertexArray(vao); // Bind dummy VAO

            // Bind static adjacency textures once
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, offsetsSpansTexture);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, flatNeighborsTexture);

            // Set uniforms that don't change per iteration
            gl.uniform1i(uniformLocations.offsetsSpansTex, 1); // Texture unit 1
            gl.uniform1i(uniformLocations.flatNeighborsTex, 2); // Texture unit 2
            gl.uniform1i(uniformLocations.posTexWidth, posTexInfo.width);
            gl.uniform1i(uniformLocations.neighborsTexWidth, neighborsTexInfo.width);

            for (let i = 0; i < numIterations; i++) {
                // 1. Bind input position texture (current state)
                gl.activeTexture(gl.TEXTURE0); // Active texture unit for positions
                gl.bindTexture(gl.TEXTURE_2D, currentPositionTexture);
                gl.uniform1i(uniformLocations.positionTex, 0); // Tell shader sampler to use texture unit 0

                // 2. Configure Transform Feedback to write to currentWriteBuffer
                gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, transformFeedback);
                gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, currentWriteBuffer);

                // 3. Execute shader (disable rasterization as we only care about TF)
                gl.enable(gl.RASTERIZER_DISCARD);
                gl.beginTransformFeedback(gl.POINTS);
                gl.drawArrays(gl.POINTS, 0, numVertices);
                gl.endTransformFeedback();
                gl.disable(gl.RASTERIZER_DISCARD);

                // 4. Unbind transform feedback buffer
                gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
                gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

                // 5. Transfer data from currentWriteBuffer to tempUnpackBuffer
                gl.bindBuffer(gl.COPY_READ_BUFFER, currentWriteBuffer); // Source for copy
                gl.bindBuffer(gl.COPY_WRITE_BUFFER, tempUnpackBuffer); // Destination for copy
                gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, numVertices * 3 * Float32Array.BYTES_PER_ELEMENT);
                gl.bindBuffer(gl.COPY_READ_BUFFER, null);
                gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);

                // 6. Update the *next* input texture with data from tempUnpackBuffer
                gl.bindTexture(gl.TEXTURE_2D, nextPositionTexture);
                gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, tempUnpackBuffer); // Use the temp buffer
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, posTexInfo.width, posTexInfo.height,
                                gl.RGB, gl.FLOAT, 0); // Offset 0 from PIXEL_UNPACK_BUFFER
                gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
                gl.bindTexture(gl.TEXTURE_2D, null);

                // 7. Ping-Pong for next iteration
                [currentPositionTexture, nextPositionTexture] = [nextPositionTexture, currentPositionTexture];
                [currentReadBuffer, currentWriteBuffer] = [currentWriteBuffer, currentReadBuffer]; // This is fine

                console.log(`Iteration ${i + 1} complete.`);
            }

            gl.bindVertexArray(null);
            gl.useProgram(null);

            // The final results are in currentReadBuffer (which was last written to)
            // and its corresponding texture currentPositionTexture

            console.timeEnd(`Smoothing ${numIterations} iterations`);

            if (!currentReadBuffer) {
                throw new Error("Smoothing has not been run or not initialized.");
            }

            const smoothedVertices = new Float32Array(numVertices * 3);
            gl.bindBuffer(gl.ARRAY_BUFFER, currentReadBuffer); // This buffer has the latest data
            gl.getBufferSubData(gl.ARRAY_BUFFER, 0, smoothedVertices);
            gl.bindBuffer(gl.ARRAY_BUFFER, null);

            console.log("Smoothed vertices retrieved:", smoothedVertices.length / 3, "vertices");

            // Optional: Generate and download/display the new OBJ
            const newObjStr = meshHandler.generateOBJString(numVertices, numFaces, smoothedVertices, faces);
            console.log(newObjStr); // For small meshes
            
            // Example: download new OBJ
            const objBlob = new Blob([newObjStr], { type: 'text/plain' });
            const downloadLink = document.createElement('a');
            downloadLink.href = URL.createObjectURL(objBlob);
            downloadLink.download = 'smoothed_model.obj';
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);

        } catch (error) {
            console.error("Error during smoothing process:", error);
        } finally {
            if (gl) {
                if (smoothingProgram) gl.deleteProgram(smoothingProgram);
                if (transformFeedback) gl.deleteTransformFeedback(transformFeedback);
                if (vao) gl.deleteVertexArray(vao);

                if (posFeedbackBufferA) gl.deleteBuffer(posFeedbackBufferA);
                if (posFeedbackBufferB) gl.deleteBuffer(posFeedbackBufferB);
                if (tempUnpackBuffer) gl.deleteBuffer(tempUnpackBuffer);

                if (positionTextureA) gl.deleteTexture(positionTextureA);
                if (positionTextureB) gl.deleteTexture(positionTextureB);
                if (offsetsSpansTexture) gl.deleteTexture(offsetsSpansTexture);
                if (flatNeighborsTexture) gl.deleteTexture(flatNeighborsTexture);

                console.log("GPU resources destroyed.");
            }
        }

    });


}

window.onload = main;
