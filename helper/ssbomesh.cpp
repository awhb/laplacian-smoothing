#include "ssbomesh.h"
#include "glutils.h"
#include "gldecl.h"

#include <cstdlib>
#include <iostream>
#include <unordered_set>
using std::cout;
using std::cerr;
using std::endl;
#include <fstream>
using std::ifstream;
#include <sstream>
using std::istringstream;

SSBOMesh::SSBOMesh(const char* fileName)
{
    loadOBJ(fileName);
}

void SSBOMesh::loadOBJ(const char* fileName) {

    vector <vec3> points;
    vector <GLuint> faces;

    int nFaces = 0;

    ifstream objStream(fileName, std::ios::in);

    if (!objStream) {
        cerr << "Unable to open OBJ file: " << fileName << endl;
        exit(1);
    }

    string line, token;
    vector<int> face;

    
    while (getline(objStream, line)) {
        trimString(line);
        if (line.length() > 0 && line.at(0) != '#') {
            istringstream lineStream(line);

            lineStream >> token;

            if (token == "v") {
                float x, y, z;
                lineStream >> x >> y >> z;
                points.push_back(vec3(x, y, z));
            }
            else if (token == "f") {
                nFaces++;

                // Process face
                face.clear();
                while (lineStream.good()) {
                    string vertString;
                    lineStream >> vertString;
                    int pIndex = -1;

                    pIndex = atoi(vertString.c_str()) - 1;
                    
                    if (pIndex == -1) {
                        printf("Missing point index!!!");
                    }
                    else {
                        face.push_back(pIndex);
                    }

                }
                // If number of edges in face is greater than 3,
                // decompose into triangles as a triangle fan.
                if (face.size() > 3) {
                    int v0 = face[0];
                    int v1 = face[1];
                    int v2 = face[2];
                    // First face
                    faces.push_back(v0);
                    faces.push_back(v1);
                    faces.push_back(v2);
                    for (GLuint i = 3; i < face.size(); i++) {
                        v1 = v2;
                        v2 = face[i];
                        faces.push_back(v0);
                        faces.push_back(v1);
                        faces.push_back(v2);
                    }
                }
                else {
                    faces.push_back(face[0]);
                    faces.push_back(face[1]);
                    faces.push_back(face[2]);
                }
            }
        }
    }

    objStream.close();

    // Generate adjacency list 
    vector<vector<GLuint>> adjacencies(points.size());
    generateAdjacencyList(points, faces, adjacencies);
    storeSSBO(adjacencies, points, faces);

    cout << "Loaded mesh from: " << fileName << endl;
    cout << " " << points.size() << " points" << endl;
    cout << " " << faces.size() / 3 << " triangles." << endl;
    cout << " " << adjacencies.size() << " adjacency entries." << endl;
}

void SSBOMesh::generateAdjacencyList(
    const vector<vec3>& points,
    const vector<GLuint>& faces,
    vector<vector<GLuint>>& adjacencies)
{
    // Using unordered_set instead of vector for O(1) lookups
    vector<std::unordered_set<GLuint>> adjacenciesSet(points.size());

    // Optional: Pre-allocate space (typical vertex has 5-8 neighbors)
    for (auto& adj : adjacenciesSet) {
        adj.reserve(8);
    }

    for (size_t i = 0; i < faces.size(); i += 3) {
        GLuint v0 = faces[i];
        GLuint v1 = faces[i + 1];
        GLuint v2 = faces[i + 2];

        // With unordered_set, insertion only happens if element doesn't exist
        adjacenciesSet[v0].insert(v1);
        adjacenciesSet[v0].insert(v2);
        adjacenciesSet[v1].insert(v0);
        adjacenciesSet[v1].insert(v2);
        adjacenciesSet[v2].insert(v0);
        adjacenciesSet[v2].insert(v1);
    }

    // Convert to vector<vector<GLuint>> for subsequent reading
    for (size_t i = 0; i < adjacenciesSet.size(); ++i) {
        adjacencies[i].reserve(adjacenciesSet[i].size());
        adjacencies[i].assign(adjacenciesSet[i].begin(), adjacenciesSet[i].end());
    }
}

void SSBOMesh::storeSSBO(const vector<vector<GLuint>>& adjacencies,
    const vector<vec3>& points,
    const vector<GLuint>& elements)
{
    vertices = GLuint(points.size());
    faces = GLuint(elements.size() / 3);

    // === SSBO for Neighbor Indices ===
    float* vertPos = new float[3 * vertices];
    float* vertPosAlt = new float[3 * vertices];
    unsigned int* spans = new unsigned int[vertices];
    unsigned int* offsets = new unsigned int[vertices];

    vector<GLuint> flatNeighbors;

    // Calculate total neighbors upfront
    size_t totalNeighbors = 0;
    for (const auto& adj : adjacencies) {
        totalNeighbors += adj.size();
    }
    flatNeighbors.reserve(totalNeighbors);

    int idx = 0, counter = 0;
    unsigned int* el = new unsigned int[elements.size()];
    for (unsigned int i = 0; i < elements.size(); ++i)
    {
        el[i] = elements[i];
    }

    for (size_t i = 0; i < vertices; ++i) {
        vertPos[idx] = points[i].x;
        vertPos[idx + 1] = points[i].y;
        vertPos[idx + 2] = points[i].z;
        vertPosAlt[idx] = points[i].x;
        vertPosAlt[idx + 1] = points[i].y;
        vertPosAlt[idx + 2] = points[i].z;
        idx += 3;
        spans[i] = (unsigned int)adjacencies[i].size();
        offsets[i] = counter;
        counter += spans[i];
        flatNeighbors.insert(flatNeighbors.end(), adjacencies[i].begin(), adjacencies[i].end());
    }

    glGenBuffers(6, ssboHandle);
    int bufIdx = 0;

    // === SSBO for Neighbor Information ===
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboHandle[bufIdx++]);
    glBufferData(GL_SHADER_STORAGE_BUFFER, flatNeighbors.size() * sizeof(GLuint), flatNeighbors.data(), GL_STATIC_DRAW);

    // === SSBO for Vertex Valence === 
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboHandle[bufIdx++]);
    glBufferData(GL_SHADER_STORAGE_BUFFER, vertices * sizeof(unsigned int), spans, GL_STATIC_DRAW);

    // === SSBO for Vertex Offset ===
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboHandle[bufIdx++]);
    glBufferData(GL_SHADER_STORAGE_BUFFER, vertices * sizeof(unsigned int), offsets, GL_STATIC_DRAW);

    // === SSBO for Vertex Position === 
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboHandle[bufIdx++]);
    glBufferData(GL_SHADER_STORAGE_BUFFER, (3 * vertices) * sizeof(float), vertPos, GL_DYNAMIC_COPY);

    // === Alternate SSBO for Vertex Information (Ping-pong target) === 
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboHandle[bufIdx++]);
    glBufferData(GL_SHADER_STORAGE_BUFFER, (3 * vertices) * sizeof(float), vertPosAlt, GL_DYNAMIC_COPY);

    // === SSBO for face information === 
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboHandle[bufIdx++]);
    glBufferData(GL_SHADER_STORAGE_BUFFER, 3 * faces * sizeof(unsigned int), el, GL_STATIC_COPY);
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, 0);
}

void SSBOMesh::smoothVertices(const int numIterations, const char outputModelFilename[]) {
    /* BIG QUESTION : To bind buffer first ? */
    for (int i = 0; i < 3; ++i) {
        glBindBufferBase(GL_SHADER_STORAGE_BUFFER, i, ssboHandle[i]); // binds neighbours, vertex valence, vertex offset
    }

    bool evenIteration = true;

    // Perform N iterations of smoothing
    for (int i = 0; i < numIterations; i++) {
        // Input is buffer 0 and output is buffer 1 on even iterations
        // Input is buffer 1 and output is buffer 0 on odd iterations
        int readIdx = evenIteration ? 3 : 4;
        int writeIdx = evenIteration ? 4 : 3;

        // Bind buffers to specific binding points
        glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 3, ssboHandle[readIdx]);  // Input
        glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 4, ssboHandle[writeIdx]); // Output

        // Dispatch compute shader
        glDispatchCompute((vertices + 255) / 256, 1, 1);

        // Ensure write finishes before next iteration reads
        glMemoryBarrier(GL_SHADER_STORAGE_BARRIER_BIT);

        // Flip for next iteration
        evenIteration = !evenIteration;
    }

    // Retrieve vertex data from GPU
    int finalBuffer = evenIteration ? 3 : 4;
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboHandle[finalBuffer]);
    float* vertexData = (float*)glMapBuffer(GL_SHADER_STORAGE_BUFFER, GL_READ_ONLY);
    glUnmapBuffer(GL_SHADER_STORAGE_BUFFER);

    if (!vertexData) {
        std::cerr << "Failed to map SSBO for reading!" << std::endl;
        return;
    }

    // Retrieve face data from GPU
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboHandle[5]);
    GLuint* faceData = (GLuint*)glMapBuffer(GL_SHADER_STORAGE_BUFFER, GL_READ_ONLY);
    glUnmapBuffer(GL_SHADER_STORAGE_BUFFER);

    if (!faceData) {
        std::cerr << "Failed to map SSBO for reading!" << std::endl;
        return;
    }

    writeOBJ(outputModelFilename, vertexData, faceData);
}

void SSBOMesh::writeOBJ(const char* fileName, const float* vertexData, const GLuint* faceData) {
    std::ofstream outFile(fileName);
    if (!outFile) {
        std::cerr << "Failed to open OBJ file for writing: " << fileName << std::endl;
        return;
    }

    // Write vertex positions
    for (size_t i = 0; i < vertices; ++i) {
        outFile << "v " << vertexData[3 * i + 0] << " "
            << vertexData[3 * i + 1] << " "
            << vertexData[3 * i + 2] << "\n";
    }

    // === Write face information (Remember OBJ file indices are 1-indexed) ===
    for (size_t i = 0; i < faces; ++i) {
        outFile << "f " << faceData[3 * i] + 1 << " "
            << faceData[3 * i + 1] + 1 << " "
            << faceData[3 * i + 2] + 1 << "\n";
    }

    outFile.close();
    std::cout << "Smoothing complete. Output written to: " << fileName << std::endl;
}


/////////////////////////////////////////////////////////////////////////////
// WARNING: IF RENDERING AFTER VERTEX SMOOTHING NEED UPDATE VBO FIRST!
/////////////////////////////////////////////////////////////////////////////

void SSBOMesh::render() const {
    cout << "Not implemented!" << endl;
}

void SSBOMesh::trimString(string& str) {
    const char* whiteSpace = " \t\n\r";
    size_t location;
    location = str.find_first_not_of(whiteSpace);
    str.erase(0, location);
    location = str.find_last_not_of(whiteSpace);
    str.erase(location + 1);
}
