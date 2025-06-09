(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['exports'], factory);
    } else if (typeof exports === 'object' && typeof exports.nodeName !== 'string') {
        // CommonJS
        factory(exports);
    } else {
        // Browser globals
        factory((root.GLSLProgram = {}));
    }
}(typeof self !== 'undefined' ? self : this, function (exports) {
    'use strict';
    
    /** @module GLSLProgram */

    function compileShader(gl, type, src) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Shader compile error: ${type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment'}\n${log}`);
        }
        return shader;
    }

    function findNumberOfComponents(gl, format) {
        let components;
        switch (format) {
            case gl.RGBA:
            case gl.RGBA_INTEGER:
                components = 4;
                break;
            case gl.RGB:
            case gl.RGB_INTEGER:
                components = 3;
                break;
            case gl.RG:
            case gl.RG_INTEGER:
                components = 2;
                break;
            case gl.RED:
            case gl.RED_INTEGER:
            case gl.DEPTH_COMPONENT:
            case gl.LUMINANCE_ALPHA:
            case gl.LUMINANCE:
            case gl.ALPHA:
                components = 1;
                break;
            default:
                throw new Error(`Unsupported format for component calculation: ${format}`);
        }
        return components; 
    }

    function padForDataTexture(requiredLength, dataArray) {
        // Create a new ArrayBuffer of the correct type, filled with zeros
        const paddedData = new dataArray.constructor(requiredLength);
        // Copy the original data into the start of the new, larger buffer
        paddedData.set(dataArray);

        return paddedData;
    }


    // handles creating and linking GLSL program 
    exports.createProgram = function (gl, vsSource, fsSource, transformFeedbackVaryings, options = {}) {
        const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vsSource);
        const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);

        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);

        if (transformFeedbackVaryings && transformFeedbackVaryings.length > 0) {
            const bufferMode = options.bufferMode || gl.SEPARATE_ATTRIBS;
            gl.transformFeedbackVaryings(program, transformFeedbackVaryings, bufferMode);
        }

        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error("Program link error:", gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
            throw new Error("Failed to link program.");
        }
        
        // Detach and delete shaders after successful link
        gl.detachShader(program, vertexShader);
        gl.detachShader(program, fragmentShader);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        return program;
    }

    exports.createBuffer = function (gl, sizeOrData, usage) {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, sizeOrData, usage);
        return buf;
    }

    exports.calculateTextureSize = function (gl, numElements) {
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

    exports.createDataTexture = function (gl, internalFormat, format, type, texInfo, dataArray = null) {
        let paddedData = dataArray; 
        if (dataArray) {
            // 1. Determine the number of components per pixel (e.g., RGB = 3, RG = 2, RED = 1)
            const components = findNumberOfComponents(gl, format);
            // 2. Calculate the required size for the full texture
            const requiredLength = texInfo.width * texInfo.height * components;
            console.warn("Padding dataArray to fit texture dimensions.", {
                    provided: dataArray.length,
                    required: requiredLength
            });
            paddedData = padForDataTexture(requiredLength, dataArray); 
        }

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // dataArray can be null for initial empty texture
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, texInfo.width, texInfo.height, 0, format, type, paddedData);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
        return texture;
    }

}));