import numpy as np

n = mesh.VPos.shape[0]
final = np.empty(n)  # Initialize with np.empty

for i in range(n):
    neighbors = mesh.vertices[i].getVertexNeighbors()
    help = [mesh.VPos[j.ID] for j in neighbors]  # Use list comprehension
    final[i] = np.mean(help)  # Use np.mean for averaging

mesh.VPos = final

