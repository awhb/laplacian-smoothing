// --- Utilities ---



/**
 * Main class for GPU-based mesh smoothing using Transform Feedback.
 */
class GPUMeshSmoother {
    constructor(gl) {
        this.gl = gl;
        if (!gl) {
            throw new Error("WebGL 2.0 context not provided or invalid.");
        }

        this.meshData = {
            vertices: null, // Float32Array for positions
            faces: null,    // Uint32Array for indices
            numVertices: 0,
            numFaces: 0,
            flatNeighbors: null,
            offsets: null,
            spans: null
        };

        // WebGL Resources
        this.smoothingProgram = null;
        this.transformFeedback = null;
        this.vao = null; // Dummy VAO

        this.positionBufferA = null;
        this.positionBufferB = null;
        this.currentReadBuffer = null;
        this.currentWriteBuffer = null;

        this.positionTextureA = null;
        this.positionTextureB = null;
        this.currentPositionTexture = null;
        this.nextPositionTexture = null;

        this.offsetsSpansTexture = null;
        this.flatNeighborsTexture = null;

        this.posTexInfo = { width: 0, height: 0 };
        this.neighborsTexInfo = { width: 0, height: 0 };
        // offsetsSpansTexture uses posTexInfo dimensions

        this.uniformLocations = {};
    }

    _calculateTextureSize(numElements) {
        const { gl } = this;
        const maxDim = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        let width, height;

        if (numElements === 0) return { width: 1, height: 1 }; // Avoid division by zero

        if (numElements <= maxDim) {
            width = numElements;
            height = 1;
        } else {
            width = Math.ceil(Math.sqrt(numElements));
            width = Math.min(width, maxDim);
            height = Math.ceil(numElements / width);
        }

        if (height > maxDim) {
            console.error(`Cannot fit ${numElements} elements into texture. Max dimension: ${maxDim}. Required height: ${height} for width: ${width}`);
            throw new Error("Data too large for texture dimensions.");
        }
        return { width, height };
    }

    async loadMesh(objFileUrl) {
        const { vertices, faces } = await OBJLoader.load(objFileUrl);
        this.meshData.vertices = vertices;
        this.meshData.faces = faces;
        this.meshData.numVertices = vertices.length / 3;
        this.meshData.numFaces = faces.length / 3;

        const adj = MeshAdjacency.generate(this.meshData.numVertices, this.meshData.faces);
        this.meshData.flatNeighbors = adj.flatNeighbors;
        this.meshData.offsets = adj.offsets;
        this.meshData.spans = adj.spans;

        console.log(`Mesh loaded: ${this.meshData.numVertices} vertices, ${this.meshData.numFaces} faces.`);
        console.log(`Adjacency: ${adj.flatNeighbors.length} total neighbor links.`);
        this._initWebGLResources();
    }

    _createDataTexture(internalFormat, format, type, texInfo, dataArray = null) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // dataArray can be null for initial empty texture
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, texInfo.width, texInfo.height, 0, format, type, dataArray);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
        return texture;
    }

    _initWebGLResources() {
        const { gl, meshData } = this;

        // 1. Shaders and Program for smoothing
        const { vsSource, fsSource } = this._getShaderSources();
        this.smoothingProgram = this._createProgram(vsSource, fsSource, ['v_newPosition']);

        this.uniformLocations.positionTex = gl.getUniformLocation(this.smoothingProgram, "u_positionTex");
        this.uniformLocations.offsetsSpansTex = gl.getUniformLocation(this.smoothingProgram, "u_offsetsSpansTex");
        this.uniformLocations.flatNeighborsTex = gl.getUniformLocation(this.smoothingProgram, "u_flatNeighborsTex");
        this.uniformLocations.posTexWidth = gl.getUniformLocation(this.smoothingProgram, "u_posTexWidth");
        this.uniformLocations.neighborsTexWidth = gl.getUniformLocation(this.smoothingProgram, "u_neighborsTexWidth");

        // 2. Transform Feedback Object
        this.transformFeedback = gl.createTransformFeedback();

        // 3. Buffers for vertex positions (Transform Feedback targets)
        const bufferSizeBytes = meshData.numVertices * 3 * Float32Array.BYTES_PER_ELEMENT;
        this.positionBufferA = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBufferA);
        gl.bufferData(gl.ARRAY_BUFFER, bufferSizeBytes, gl.DYNAMIC_COPY); // DYNAMIC_COPY for readback + TF

        this.positionBufferB = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBufferB);
        gl.bufferData(gl.ARRAY_BUFFER, bufferSizeBytes, gl.DYNAMIC_COPY);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        // 4. Textures
        // Position Textures (RGB32F)
        this.posTexInfo = this._calculateTextureSize(meshData.numVertices);
        this.positionTextureA = this._createDataTexture(gl.RGB32F, gl.RGB, gl.FLOAT, this.posTexInfo, meshData.vertices);
        this.positionTextureB = this._createDataTexture(gl.RGB32F, gl.RGB, gl.FLOAT, this.posTexInfo, null); // Empty

        // Adjacency Textures (Integer Textures)
        // Offsets and Spans (RG32UI) - combines meshData.offsets and meshData.spans
        const offsetsSpansData = new Uint32Array(meshData.numVertices * 2);
        for (let i = 0; i < meshData.numVertices; i++) {
            offsetsSpansData[i * 2 + 0] = meshData.offsets[i];
            offsetsSpansData[i * 2 + 1] = meshData.spans[i];
        }
        this.offsetsSpansTexture = this._createDataTexture(gl.RG32UI, gl.RG_INTEGER, gl.UNSIGNED_INT, this.posTexInfo, offsetsSpansData);

        // Flat Neighbors (R32UI)
        this.neighborsTexInfo = this._calculateTextureSize(meshData.flatNeighbors.length);
        this.flatNeighborsTexture = this._createDataTexture(gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, this.neighborsTexInfo, meshData.flatNeighbors);

        // 5. Dummy VAO (needed for gl.drawArrays in WebGL 2.0 core profile if no attributes are bound)
        this.vao = gl.createVertexArray();
    }

    smooth(numIterations = 1) {
        const { gl, meshData, smoothingProgram, transformFeedback, uniformLocations } = this;
        if (!smoothingProgram || !meshData.vertices) {
            throw new Error("Smoother not initialized or mesh not loaded.");
        }

        this.currentPositionTexture = this.positionTextureA;
        this.nextPositionTexture = this.positionTextureB;
        this.currentReadBuffer = this.positionBufferA; // Buffer corresponding to positionTextureA
        this.currentWriteBuffer = this.positionBufferB;


        gl.useProgram(smoothingProgram);
        gl.bindVertexArray(this.vao); // Bind dummy VAO

        // Set uniforms that don't change per iteration
        gl.uniform1i(uniformLocations.offsetsSpansTex, 1); // Texture unit 1
        gl.uniform1i(uniformLocations.flatNeighborsTex, 2); // Texture unit 2
        gl.uniform1i(uniformLocations.posTexWidth, this.posTexInfo.width);
        gl.uniform1i(uniformLocations.neighborsTexWidth, this.neighborsTexInfo.width);

        // Bind static adjacency textures once
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.offsetsSpansTexture);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.flatNeighborsTexture);

        for (let i = 0; i < numIterations; i++) {
            // 1. Bind input position texture (current state)
            gl.activeTexture(gl.TEXTURE0); // Active texture unit for positions
            gl.bindTexture(gl.TEXTURE_2D, this.currentPositionTexture);
            gl.uniform1i(uniformLocations.positionTex, 0); // Tell shader sampler to use texture unit 0

            // 2. Configure Transform Feedback to write to currentWriteBuffer
            gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, transformFeedback);
            gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.currentWriteBuffer);

            // 3. Execute shader (disable rasterization as we only care about TF)
            gl.enable(gl.RASTERIZER_DISCARD);
            gl.beginTransformFeedback(gl.POINTS);
            gl.drawArrays(gl.POINTS, 0, meshData.numVertices);
            gl.endTransformFeedback();
            gl.disable(gl.RASTERIZER_DISCARD);

            // 4. Unbind transform feedback buffer
            gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
            gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);


            // 5. Update the *next* input texture with data from currentWriteBuffer
            gl.bindTexture(gl.TEXTURE_2D, this.nextPositionTexture);
            gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, this.currentWriteBuffer);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.posTexInfo.width, this.posTexInfo.height,
                              gl.RGB, gl.FLOAT, 0); // Offset 0 from PIXEL_UNPACK_BUFFER
            gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
            gl.bindTexture(gl.TEXTURE_2D, null);


            // 6. Ping-Pong for next iteration
            [this.currentPositionTexture, this.nextPositionTexture] = [this.nextPositionTexture, this.currentPositionTexture];
            [this.currentReadBuffer, this.currentWriteBuffer] = [this.currentWriteBuffer, this.currentReadBuffer];

            // console.log(`Iteration ${i + 1} complete.`);
        }

        gl.bindVertexArray(null);
        gl.useProgram(null);

        // The final results are in currentReadBuffer (which was last written to)
        // and its corresponding texture currentPositionTexture
    }

    getSmoothedVertexData() {
        const { gl, meshData } = this;
        if (!this.currentReadBuffer) {
            throw new Error("Smoothing has not been run or not initialized.");
        }

        const resultData = new Float32Array(meshData.numVertices * 3);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.currentReadBuffer); // This buffer has the latest data
        gl.getBufferSubData(gl.ARRAY_BUFFER, 0, resultData);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        return resultData;
    }

    getOBJString(smoothedVertices) {
        if (!this.meshData.faces || !smoothedVertices) {
            return "";
        }
        let objStr = "# Smoothed Mesh Output\n";
        for (let i = 0; i < this.meshData.numVertices; i++) {
            objStr += `v ${smoothedVertices[i * 3]} ${smoothedVertices[i * 3 + 1]} ${smoothedVertices[i * 3 + 2]}\n`;
        }
        objStr += "\n";
        for (let i = 0; i < this.meshData.numFaces; i++) {
            // OBJ indices are 1-based
            objStr += `f ${this.meshData.faces[i * 3] + 1} ${this.meshData.faces[i * 3 + 1] + 1} ${this.meshData.faces[i * 3 + 2] + 1}\n`;
        }
        return objStr;
    }
    
    destroy() {
        const { gl } = this;
        if (this.smoothingProgram) gl.deleteProgram(this.smoothingProgram);
        if (this.transformFeedback) gl.deleteTransformFeedback(this.transformFeedback);
        if (this.vao) gl.deleteVertexArray(this.vao);

        if (this.positionBufferA) gl.deleteBuffer(this.positionBufferA);
        if (this.positionBufferB) gl.deleteBuffer(this.positionBufferB);

        if (this.positionTextureA) gl.deleteTexture(this.positionTextureA);
        if (this.positionTextureB) gl.deleteTexture(this.positionTextureB);
        if (this.offsetsSpansTexture) gl.deleteTexture(this.offsetsSpansTexture);
        if (this.flatNeighborsTexture) gl.deleteTexture(this.flatNeighborsTexture);

        // Nullify properties
        for (const key in this) {
            if (this.hasOwnProperty(key) && typeof this[key] !== 'function' && key !== 'gl' && key !== 'meshData') {
                 if (typeof this[key] === 'object' && this[key] !== null && 'length' in this[key] === false && Object.keys(this[key]).length === 0) { // Check for empty objects like uniformLocations
                    // Don't nullify meshData basics like numVertices if needed later
                } else {
                    this[key] = null;
                }
            }
        }
        // Specifically clear meshData GPU-related arrays if they are large, but keep core counts
        if (this.meshData) {
            this.meshData.flatNeighbors = null;
            this.meshData.offsets = null;
            this.meshData.spans = null;
            // Keep vertices/faces if they might be reused without reloading
        }
        console.log("GPUMeshSmoother resources destroyed.");
    }
}

// --- Example Usage (HTML file would need a canvas and an OBJ file served) ---
/*
async function main() {
    const canvas = document.getElementById('glCanvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) {
        alert('WebGL 2.0 not available');
        return;
    }

    // Make sure your OBJ file is accessible, e.g., same origin or CORS enabled
    const objUrl = 'path/to/your/model.obj'; 
    const smoother = new GPUMeshSmoother(gl);

    try {
        await smoother.loadMesh(objUrl);
        
        const numIterations = 10; // Number of smoothing iterations
        console.time(`Smoothing ${numIterations} iterations`);
        smoother.smooth(numIterations);
        console.timeEnd(`Smoothing ${numIterations} iterations`);

        const smoothedVertices = smoother.getSmoothedVertexData();
        console.log("Smoothed vertices retrieved:", smoothedVertices.length / 3, "vertices");

        // Optional: Generate and download/display the new OBJ
        const newObjStr = smoother.getOBJString(smoothedVertices);
        // console.log(newObjStr); // For small meshes
        
        // Example: download new OBJ
        // const blob = new Blob([newObjStr], { type: 'text/plain' });
        // const downloadLink = document.createElement('a');
        // downloadLink.href = URL.createObjectURL(blob);
        // downloadLink.download = 'smoothed_model.obj';
        // document.body.appendChild(downloadLink);
        // downloadLink.click();
        // document.body.removeChild(downloadLink);

    } catch (error) {
        console.error("Error during smoothing process:", error);
    } finally {
        if (smoother) {
            // smoother.destroy(); // Clean up WebGL resources when done
        }
    }
}

// window.onload = main;
*/