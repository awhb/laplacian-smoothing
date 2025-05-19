#include <cstdlib>
#include <cstdio>
#include <iostream>
using namespace std;

#include <GL/glew.h>
#include <GLFW/glfw3.h>

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

#define STB_IMAGE_IMPLEMENTATION
#include <stb_image.h>

#include "helper/glslprogram.h"
#include "helper/ssbomesh.h"


/////////////////////////////////////////////////////////////////////////////
// VALUES THAT YOU CHANGE FOR DIFFERENT INPUT MODEL (OBJ FILE) AND
// TO CONTROL HOW GOOD THE SOLUTION YOU WANT
/////////////////////////////////////////////////////////////////////////////

// Input model filename.
static const char inputModelFilename[] = "in.obj";

// Output model filename.
static const char outputModelFilename[] = "out.obj";

// Shader's filename.
const char compShaderFile[] = "shader.comp";

// This value stores how many iterations of Laplacian smoothing is to be performed on the mesh.
int numIterations = 1;

GLSLProgram shaderProg;  // Contains the shader program object.

SSBOMesh* objMesh;     // Contains the 3D mesh.


// For window and viewport size.
int winWidth = 800;     // Window width in pixels.
int winHeight = 600;    // Window height in pixels.

bool wireframeMode = false;



static void glfw_error_callback(int error, const char* description)
{
    fprintf(stderr, "Error: %s\n", description);
}



static void WaitForEnterKeyBeforeExit(void)
{
    fflush(stdin);
    getchar();
}



/////////////////////////////////////////////////////////////////////////////
// The main function.
/////////////////////////////////////////////////////////////////////////////


int main(int argc, char** argv)
{
    atexit(WaitForEnterKeyBeforeExit); // std::atexit() is declared in cstdlib

    glfwSetErrorCallback(glfw_error_callback);
    if (!glfwInit()) exit(EXIT_FAILURE);

    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 4);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GL_TRUE);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    glfwWindowHint(GLFW_VISIBLE, GLFW_FALSE); // Creates a hidden dummy window (we just need a context)
    GLFWwindow* window = glfwCreateWindow(winWidth, winHeight, "main", NULL, NULL);
    glfwGetFramebufferSize(window, &winWidth, &winHeight); // Required for macOS.

    if (!window) {
        glfwTerminate();
        exit(EXIT_FAILURE);
    }

    glfwMakeContextCurrent(window);


    // Initialize GLEW.
    GLenum err = glewInit();
    if (err != GLEW_OK)
    {
        fprintf(stderr, "Error: %s.\n", glewGetErrorString(err));
        exit(EXIT_FAILURE);
    }
    printf("Using GLEW %s.\n", glewGetString(GLEW_VERSION));
    printf("System supports OpenGL %s.\n", glGetString(GL_VERSION));

    /* Laplacian smoothing program runs */
    try {
        shaderProg.compileShader(compShaderFile, GLSLShader::COMPUTE);
        shaderProg.link();
        shaderProg.validate();
        shaderProg.use(); // Install shader program to rendering pipeline.
    }
    catch (GLSLProgramException& e) {
        fprintf(stderr, "Error: %s.\n", e.what());
        glfwDestroyWindow(window);
        glfwTerminate();
        exit(EXIT_FAILURE);
    }

    objMesh = new SSBOMesh(inputModelFilename);
    objMesh->smoothVertices(numIterations, outputModelFilename);

    std::cout << "Smoothing complete. Output written to: " << outputModelFilename << "\n";

    glfwDestroyWindow(window);
    glfwTerminate();
    return EXIT_SUCCESS;
}
