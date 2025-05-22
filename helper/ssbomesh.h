#ifndef SSBOMESH_H
#define SSBOMESH_H

#include "drawable.h"

#include <vector>
using std::vector;
#include <glm/glm.hpp>
using glm::vec3;
using glm::vec2;
using glm::vec4;

#include <string>
using std::string;

#include "gldecl.h"

class SSBOMesh : public Drawable
{
private:
    GLuint faces;              // Number of triangle faces 
    GLuint vertices;           // Number of vertices
    GLuint vaoHandle;
    GLuint ssboHandle[6];

    void trimString(string& str);
    void storeVBO(
        const vector<vec3>& points,
        const vector<vec3>& normals,
        const vector<vec2>& texCoords,
        const vector<vec4>& tangents,
        const vector<GLuint>& elements);
    void storeSSBO(
        const vector<vector<GLuint>>& adjacencies,
        const vector<vec3>& points,
        const vector<GLuint>& elements);
    void generateAdjacencyList(
        const vector<vec3>& points,
        const vector<GLuint>& faces,
        vector<vector<GLuint>>& adjacencies
    );

public:
    SSBOMesh(const char* fileName);

    void render() const;

    void smoothVertices(const int numIterations, const char outputModelFilename[]);

    void loadOBJ(const char* fileName);

    void writeOBJ(const char* fileName, const float* vertexData, const GLuint* faceData);
};

#endif // SSBOMESH_H
