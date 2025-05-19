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

struct ssboVertex {
    vec3 position;
    GLuint offset;
    GLuint valence;
};

class SSBOMesh : public Drawable
{
private:
    GLuint faces;              // Number of triangle faces 
    GLuint vertices;           // Number of vertices
    GLuint vaoHandle;    
    GLuint ssboFlatNeighbors;
    GLuint ssboVertices;
    GLuint ssboAltVertices;
    GLuint ssboFaces;

    bool reCenterMesh, loadTex, genTang;

    void trimString( string & str );
    void storeVBO( 
        const vector<vec3> & points,
        const vector<vec3> & normals,
        const vector<vec2> & texCoords,
        const vector<vec4> & tangents,
        const vector<GLuint> & elements );
    void storeSSBO(
        const vector<vector<GLuint>> & adjacencies,
        const vector<vec3>& points,
        const vector<GLuint>& elements );
    void generateAdjacencyList(
        const vector<vec3> & points,
        const vector<GLuint> & faces,
        vector<vector<GLuint>> & adjacencies
    );
    void generateAveragedNormals(
            const vector<vec3> & points,
            vector<vec3> & normals,
            const vector<GLuint> & faces );
    void generateTangents(
            const vector<vec3> & points,
            const vector<vec3> & normals,
            const vector<GLuint> & faces,
            const vector<vec2> & texCoords,
            vector<vec4> & tangents);
    void center(vector<vec3> &);

public:
    SSBOMesh( const char * fileName, bool reCenterMesh = false, bool loadTc = false, bool genTangents = false );

    void render() const;

    void smoothVertices( const int numIterations, const char outputModelFilename[] );

    void loadOBJ( const char * fileName );

    void writeOBJ( const char * fileName );
};

#endif // SSBOMESH_H
