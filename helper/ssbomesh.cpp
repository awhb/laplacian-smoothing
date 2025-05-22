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

SSBOMesh::SSBOMesh(const char* fileName, bool center, bool loadTc, bool genTangents) :
    reCenterMesh(center), loadTex(loadTc), genTang(genTangents)
{
    loadOBJ(fileName);
}

void SSBOMesh::loadOBJ(const char* fileName) {

    vector <vec3> points;
    vector <vec3> normals;
    vector <vec2> texCoords;
    vector <GLuint> faces;

    int nFaces = 0;

    ifstream objStream(fileName, std::ios::in);

    if (!objStream) {
        cerr << "Unable to open OBJ file: " << fileName << endl;
        exit(1);
    }

    string line, token;
    vector<int> face;

    getline(objStream, line);
    while (!objStream.eof()) {
        trimString(line);
        if (line.length() > 0 && line.at(0) != '#') {
            istringstream lineStream(line);

            lineStream >> token;

            if (token == "v") {
                float x, y, z;
                lineStream >> x >> y >> z;
                points.push_back(vec3(x, y, z));
            }
            else if (token == "vt" && loadTex) {
                // Process texture coordinate
                float s, t;
                lineStream >> s >> t;
                texCoords.push_back(vec2(s, t));
            }
            else if (token == "vn") {
                float x, y, z;
                lineStream >> x >> y >> z;
                normals.push_back(vec3(x, y, z));
            }
            else if (token == "f") {
                nFaces++;

                // Process face
                face.clear();
                size_t slash1, slash2;
                //int point, texCoord, normal;
                while (lineStream.good()) {
                    string vertString;
                    lineStream >> vertString;
                    int pIndex = -1, nIndex = -1, tcIndex = -1;

                    slash1 = vertString.find("/");
                    if (slash1 == string::npos) {
                        pIndex = atoi(vertString.c_str()) - 1;
                    }
                    else {
                        slash2 = vertString.find("/", slash1 + 1);
                        pIndex = atoi(vertString.substr(0, slash1).c_str())
                            - 1;
                        if (slash2 > slash1 + 1) {
                            tcIndex =
                                atoi(vertString.substr(slash1 + 1, slash2).c_str())
                                - 1;
                        }
                        nIndex =
                            atoi(vertString.substr(slash2 + 1, vertString.length()).c_str())
                            - 1;
                    }
                    if (pIndex == -1) {
                        printf("Missing point index!!!");
                    }
                    else {
                        face.push_back(pIndex);
                    }

                    if (loadTex && tcIndex != -1 && pIndex != tcIndex) {
                        printf("Texture and point indices are not consistent.\n");
                    }
                    if (nIndex != -1 && nIndex != pIndex) {
                        printf("Normal and point indices are not consistent.\n");
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
        getline(objStream, line);
    }

    objStream.close();

    if (normals.size() == 0) {
        generateAveragedNormals(points, normals, faces);
    }

    vector<vec4> tangents;
    if (genTang && texCoords.size() > 0) {
        generateTangents(points, normals, faces, texCoords, tangents);
    }

    if (reCenterMesh) {
        center(points);
    }

    // Generate adjacency list 
    vector<vector<GLuint>> adjacencies(points.size());
    generateAdjacencyList(points, faces, adjacencies);

    // storeVBO(points, normals, texCoords, tangents, faces);   /* NOT NEEDED FOR NOW */
    storeSSBO(adjacencies, points, faces);

    cout << "Loaded mesh from: " << fileName << endl;
    cout << " " << points.size() << " points" << endl;
    cout << " " << nFaces << " faces" << endl;
    cout << " " << faces.size() / 3 << " triangles." << endl;
    cout << " " << normals.size() << " normals" << endl;
    cout << " " << tangents.size() << " tangents " << endl;
    cout << " " << texCoords.size() << " texture coordinates." << endl;
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

        cout << "Until compute shader is fine." << endl;

        // Dispatch compute shader
        glDispatchCompute((vertices + 255) / 256, 1, 1);

        // Ensure write finishes before next iteration reads
        glMemoryBarrier(GL_SHADER_STORAGE_BARRIER_BIT);

        // Flip for next iteration
        evenIteration = !evenIteration;
    }

    if (numIterations % 2 == 0) {
        ssboHandle[4] = ssboHandle[3]; // copy data back to alternate array
    }

    writeOBJ(outputModelFilename);
}

void SSBOMesh::writeOBJ(const char* fileName) {
    std::ofstream outFile(fileName);
    if (!outFile) {
        std::cerr << "Failed to open OBJ file for writing: " << fileName << std::endl;
        return;
    }

    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboHandle[4]);
    ssboVertex* vertexData = (ssboVertex*)glMapBuffer(GL_SHADER_STORAGE_BUFFER, GL_READ_ONLY);

    if (!vertexData) {
        std::cerr << "Failed to map SSBO for reading!" << std::endl;
        return;
    }

    // Write vertex positions
    for (size_t i = 0; i < vertices; ++i) {
        outFile << "v " << vertexData[i].position.x << " "
            << vertexData[i].position.y << " "
            << vertexData[i].position.z << "\n";
    }

    glUnmapBuffer(GL_SHADER_STORAGE_BUFFER);

    // === Write face information (Remember OBJ file indices are 1-indexed) ===
    glBindBuffer(GL_SHADER_STORAGE_BUFFER, ssboHandle[5]);
    GLuint* faceData = (GLuint*)glMapBuffer(GL_SHADER_STORAGE_BUFFER, GL_READ_ONLY);

    if (!faceData) {
        std::cerr << "Failed to map SSBO for reading!" << std::endl;
        return;
    }

    for (size_t i = 0; i < faces; ++i) {
        outFile << "f " << faceData[i * 3] + 1 << " "
            << faceData[i * 3 + 1] + 1 << " "
            << faceData[i * 3 + 2] + 1 << "\n";
    }

    glUnmapBuffer(GL_SHADER_STORAGE_BUFFER);

    outFile.close();

    std::cout << "Smoothing complete. Output written to: " << fileName << std::endl;
}

/////////////////////////////////////////////////////////////////////////////
// NON-CRUCIAL CLASS METHODS (ASSUME CORRECT) 
/////////////////////////////////////////////////////////////////////////////

void SSBOMesh::center(vector<vec3>& points) {
    if (points.size() < 1) return;

    vec3 maxPoint = points[0];
    vec3 minPoint = points[0];

    // Find the AABB
    for (GLuint i = 0; i < points.size(); ++i) {
        vec3& point = points[i];
        if (point.x > maxPoint.x) maxPoint.x = point.x;
        if (point.y > maxPoint.y) maxPoint.y = point.y;
        if (point.z > maxPoint.z) maxPoint.z = point.z;
        if (point.x < minPoint.x) minPoint.x = point.x;
        if (point.y < minPoint.y) minPoint.y = point.y;
        if (point.z < minPoint.z) minPoint.z = point.z;
    }

    // Center of the AABB
    vec3 center = vec3((maxPoint.x + minPoint.x) / 2.0f,
        (maxPoint.y + minPoint.y) / 2.0f,
        (maxPoint.z + minPoint.z) / 2.0f);

    // Translate center of the AABB to the origin
    for (GLuint i = 0; i < points.size(); ++i) {
        vec3& point = points[i];
        point = point - center;
    }
}

void SSBOMesh::generateAveragedNormals(
    const vector<vec3>& points,
    vector<vec3>& normals,
    const vector<GLuint>& faces)
{
    for (GLuint i = 0; i < points.size(); i++) {
        normals.push_back(vec3(0.0f));
    }

    for (GLuint i = 0; i < faces.size(); i += 3) {
        const vec3& p1 = points[faces[i]];
        const vec3& p2 = points[faces[i + 1]];
        const vec3& p3 = points[faces[i + 2]];

        vec3 a = p2 - p1;
        vec3 b = p3 - p1;
        vec3 n = glm::normalize(glm::cross(a, b));

        normals[faces[i]] += n;
        normals[faces[i + 1]] += n;
        normals[faces[i + 2]] += n;
    }

    for (GLuint i = 0; i < normals.size(); i++) {
        normals[i] = glm::normalize(normals[i]);
    }
}

void SSBOMesh::generateTangents(
    const vector<vec3>& points,
    const vector<vec3>& normals,
    const vector<GLuint>& faces,
    const vector<vec2>& texCoords,
    vector<vec4>& tangents)
{
    vector<vec3> tan1Accum;
    vector<vec3> tan2Accum;

    for (GLuint i = 0; i < points.size(); i++) {
        tan1Accum.push_back(vec3(0.0f));
        tan2Accum.push_back(vec3(0.0f));
        tangents.push_back(vec4(0.0f));
    }

    // Compute the tangent vector
    for (GLuint i = 0; i < faces.size(); i += 3)
    {
        const vec3& p1 = points[faces[i]];
        const vec3& p2 = points[faces[i + 1]];
        const vec3& p3 = points[faces[i + 2]];

        const vec2& tc1 = texCoords[faces[i]];
        const vec2& tc2 = texCoords[faces[i + 1]];
        const vec2& tc3 = texCoords[faces[i + 2]];

        vec3 q1 = p2 - p1;
        vec3 q2 = p3 - p1;
        float s1 = tc2.x - tc1.x, s2 = tc3.x - tc1.x;
        float t1 = tc2.y - tc1.y, t2 = tc3.y - tc1.y;
        float r = 1.0f / (s1 * t2 - s2 * t1);
        vec3 tan1((t2 * q1.x - t1 * q2.x) * r,
            (t2 * q1.y - t1 * q2.y) * r,
            (t2 * q1.z - t1 * q2.z) * r);
        vec3 tan2((s1 * q2.x - s2 * q1.x) * r,
            (s1 * q2.y - s2 * q1.y) * r,
            (s1 * q2.z - s2 * q1.z) * r);
        tan1Accum[faces[i]] += tan1;
        tan1Accum[faces[i + 1]] += tan1;
        tan1Accum[faces[i + 2]] += tan1;
        tan2Accum[faces[i]] += tan2;
        tan2Accum[faces[i + 1]] += tan2;
        tan2Accum[faces[i + 2]] += tan2;
    }

    for (GLuint i = 0; i < points.size(); ++i)
    {
        const vec3& n = normals[i];
        vec3& t1 = tan1Accum[i];
        vec3& t2 = tan2Accum[i];

        // Gram-Schmidt orthogonalize
        tangents[i] = vec4(glm::normalize(t1 - (glm::dot(n, t1) * n)), 0.0f);
        // Store handedness in w
        tangents[i].w = (glm::dot(glm::cross(n, t1), t2) < 0.0f) ? -1.0f : 1.0f;
    }
    tan1Accum.clear();
    tan2Accum.clear();
}


/////////////////////////////////////////////////////////////////////////////
// CLASS METHODS NOT RELEVANT RIGHT NOW (ASSUME CORRECT)
/////////////////////////////////////////////////////////////////////////////

void SSBOMesh::storeVBO(const vector<vec3>& points,
    const vector<vec3>& normals,
    const vector<vec2>& texCoords,
    const vector<vec4>& tangents,
    const vector<GLuint>& elements)
{
    vertices = GLuint(points.size());
    faces = GLuint(elements.size() / 3);


    float* v = new float[3 * vertices];
    float* n = new float[3 * vertices];
    float* tc = NULL;
    float* tang = NULL;

    if (texCoords.size() > 0) {
        tc = new float[2 * vertices];
        if (tangents.size() > 0)
            tang = new float[4 * vertices];
    }

    unsigned int* el = new unsigned int[elements.size()];

    int idx = 0, tcIdx = 0, tangIdx = 0;
    for (GLuint i = 0; i < vertices; ++i)
    {
        v[idx] = points[i].x;
        v[idx + 1] = points[i].y;
        v[idx + 2] = points[i].z;
        n[idx] = normals[i].x;
        n[idx + 1] = normals[i].y;
        n[idx + 2] = normals[i].z;
        idx += 3;
        if (tc != NULL) {
            tc[tcIdx] = texCoords[i].x;
            tc[tcIdx + 1] = texCoords[i].y;
            tcIdx += 2;
        }
        if (tang != NULL) {
            tang[tangIdx] = tangents[i].x;
            tang[tangIdx + 1] = tangents[i].y;
            tang[tangIdx + 2] = tangents[i].z;
            tang[tangIdx + 3] = tangents[i].w;
            tangIdx += 4;
        }
    }
    for (unsigned int i = 0; i < elements.size(); ++i)
    {
        el[i] = elements[i];
    }
    glGenVertexArrays(1, &vaoHandle);
    glBindVertexArray(vaoHandle);

    int nBuffers = 3;
    if (tc != NULL) nBuffers++;
    if (tang != NULL) nBuffers++;
    GLuint elementBuffer = nBuffers - 1;

    GLuint handle[5];
    GLuint bufIdx = 0;
    glGenBuffers(nBuffers, handle);

    glBindBuffer(GL_ARRAY_BUFFER, handle[bufIdx++]);
    glBufferData(GL_ARRAY_BUFFER, (3 * vertices) * sizeof(float), v, GL_STATIC_DRAW);
    glVertexAttribPointer((GLuint)0, 3, GL_FLOAT, GL_FALSE, 0, ((GLubyte*)NULL + (0)));
    glEnableVertexAttribArray(0);  // Vertex position

    glBindBuffer(GL_ARRAY_BUFFER, handle[bufIdx++]);
    glBufferData(GL_ARRAY_BUFFER, (3 * vertices) * sizeof(float), n, GL_STATIC_DRAW);
    glVertexAttribPointer((GLuint)1, 3, GL_FLOAT, GL_FALSE, 0, ((GLubyte*)NULL + (0)));
    glEnableVertexAttribArray(1);  // Vertex normal

    if (tc != NULL) {
        glBindBuffer(GL_ARRAY_BUFFER, handle[bufIdx++]);
        glBufferData(GL_ARRAY_BUFFER, (2 * vertices) * sizeof(float), tc, GL_STATIC_DRAW);
        glVertexAttribPointer((GLuint)2, 2, GL_FLOAT, GL_FALSE, 0, ((GLubyte*)NULL + (0)));
        glEnableVertexAttribArray(2);  // Texture coords
    }
    if (tang != NULL) {
        glBindBuffer(GL_ARRAY_BUFFER, handle[bufIdx++]);
        glBufferData(GL_ARRAY_BUFFER, (4 * vertices) * sizeof(float), tang, GL_STATIC_DRAW);
        glVertexAttribPointer((GLuint)3, 4, GL_FLOAT, GL_FALSE, 0, ((GLubyte*)NULL + (0)));
        glEnableVertexAttribArray(3);  // Tangent vector
    }

    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, handle[elementBuffer]);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, 3 * faces * sizeof(unsigned int), el, GL_STATIC_DRAW);

    glBindVertexArray(0);

    // Clean up
    delete[] v;
    delete[] n;
    if (tc != NULL) delete[] tc;
    if (tang != NULL) delete[] tang;
    delete[] el;
}

/////////////////////////////////////////////////////////////////////////////
// WARNING: IF RENDERING AFTER VERTEX SMOOTHING NEED UPDATE VBO FIRST!
/////////////////////////////////////////////////////////////////////////////

void SSBOMesh::render() const {
    glBindVertexArray(vaoHandle);
    glDrawElements(GL_TRIANGLES, 3 * faces, GL_UNSIGNED_INT, ((GLubyte*)NULL + (0)));
}

void SSBOMesh::trimString(string& str) {
    const char* whiteSpace = " \t\n\r";
    size_t location;
    location = str.find_first_not_of(whiteSpace);
    str.erase(0, location);
    location = str.find_last_not_of(whiteSpace);
    str.erase(location + 1);
}
