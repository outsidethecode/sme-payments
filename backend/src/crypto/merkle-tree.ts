import { createHash } from "crypto";

/**
 * Merkle Tree — Binary SHA-256 tree for ledger anchoring.
 *
 * Leaf nodes are entity head hashes (already SHA-256 hex strings).
 * Interior nodes = SHA-256(left || right) where || is pipe-delimited.
 * If the leaf count is odd, the last leaf is duplicated.
 *
 * This provides:
 *   - A single Merkle root that covers all entity chains
 *   - O(log N) inclusion proofs for any leaf
 *   - Efficient verification without revealing the full tree
 */

export interface MerkleProofStep {
  /** "left" means this hash should be prepended; "right" means appended */
  position: "left" | "right";
  hash: string;
}

export interface MerkleTree {
  root: string;
  leaves: string[];
  /** All tree levels, from leaves (index 0) to root (last index) */
  levels: string[][];
}

/**
 * Compute SHA-256 hex of two hashes joined by pipe.
 */
function hashPair(left: string, right: string): string {
  return createHash("sha256").update(`${left}|${right}`).digest("hex");
}

/**
 * Build a Merkle tree from an array of leaf hashes.
 *
 * @param leaves - Array of hex-encoded SHA-256 hashes (already sorted by caller).
 *                 Must have at least 1 leaf.
 * @returns The complete tree (root, leaves, all levels).
 */
export function buildMerkleTree(leaves: string[]): MerkleTree {
  if (leaves.length === 0) {
    throw new Error("Cannot build Merkle tree from empty leaf set");
  }

  // Single leaf — root is the leaf itself
  if (leaves.length === 1) {
    return {
      root: leaves[0],
      leaves: [...leaves],
      levels: [[...leaves]],
    };
  }

  const levels: string[][] = [[...leaves]];

  let currentLevel = [...leaves];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      // If odd number of nodes, duplicate the last one
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      nextLevel.push(hashPair(left, right));
    }

    levels.push(nextLevel);
    currentLevel = nextLevel;
  }

  return {
    root: currentLevel[0],
    leaves: [...leaves],
    levels,
  };
}

/**
 * Generate a Merkle inclusion proof for a leaf at a given index.
 *
 * The proof is an array of {position, hash} steps. To verify,
 * start with the leaf hash and iteratively combine with each step:
 *   - If position === "right", compute SHA-256(current | step.hash)
 *   - If position === "left",  compute SHA-256(step.hash | current)
 *
 * The final result should equal the Merkle root.
 *
 * @param tree - The full Merkle tree
 * @param leafIndex - Index of the leaf to prove
 * @returns Array of proof steps from leaf to root
 */
export function generateMerkleProof(
  tree: MerkleTree,
  leafIndex: number,
): MerkleProofStep[] {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) {
    throw new Error(
      `Leaf index ${leafIndex} out of range [0, ${tree.leaves.length})`,
    );
  }

  // Single leaf — no proof needed (leaf IS the root)
  if (tree.leaves.length === 1) {
    return [];
  }

  const proof: MerkleProofStep[] = [];
  let idx = leafIndex;

  for (let level = 0; level < tree.levels.length - 1; level++) {
    const currentLevelNodes = tree.levels[level];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;

    if (siblingIdx < currentLevelNodes.length) {
      proof.push({
        position: isRight ? "left" : "right",
        hash: currentLevelNodes[siblingIdx],
      });
    } else {
      // Odd node count — sibling is a duplicate of the current node
      proof.push({
        position: "right",
        hash: currentLevelNodes[idx],
      });
    }

    // Move to parent index
    idx = Math.floor(idx / 2);
  }

  return proof;
}

/**
 * Verify a Merkle inclusion proof.
 *
 * @param leafHash - The hash of the leaf being proved
 * @param proof - Array of proof steps
 * @param expectedRoot - The expected Merkle root
 * @returns true if the proof is valid
 */
export function verifyMerkleProof(
  leafHash: string,
  proof: MerkleProofStep[],
  expectedRoot: string,
): boolean {
  let current = leafHash;

  for (const step of proof) {
    if (step.position === "left") {
      current = hashPair(step.hash, current);
    } else {
      current = hashPair(current, step.hash);
    }
  }

  return current === expectedRoot;
}

/**
 * Build a Merkle tree from entity head hashes.
 *
 * Takes a map of {entityId: lastEventHash} and returns a tree
 * where leaves are "entityId:lastEventHash" hashed, sorted by entityId.
 *
 * @param headHashes - Map of entityId → lastEventHash
 * @returns The tree plus an ordered list of entityIds (for proof index lookup)
 */
export function buildEntityMerkleTree(
  headHashes: Record<string, string>,
): MerkleTree & { entityOrder: string[] } {
  const sortedEntries = Object.entries(headHashes).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const entityOrder = sortedEntries.map(([id]) => id);

  // Each leaf = SHA-256(entityId:lastEventHash)
  const leaves = sortedEntries.map(([entityId, hash]) =>
    createHash("sha256").update(`${entityId}:${hash}`).digest("hex"),
  );

  const tree = buildMerkleTree(leaves);

  return {
    ...tree,
    entityOrder,
  };
}

/**
 * Generate a Merkle inclusion proof for a specific entity.
 *
 * @param headHashes - Map of entityId → lastEventHash
 * @param entityId - The entity to prove
 * @returns The proof steps + the leaf hash, or null if entity not in the tree
 */
export function generateEntityProof(
  headHashes: Record<string, string>,
  entityId: string,
): { leafHash: string; proof: MerkleProofStep[] } | null {
  const treeResult = buildEntityMerkleTree(headHashes);
  const idx = treeResult.entityOrder.indexOf(entityId);

  if (idx === -1) return null;

  return {
    leafHash: treeResult.leaves[idx],
    proof: generateMerkleProof(treeResult, idx),
  };
}
