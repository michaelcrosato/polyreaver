// Account for the actual buffers and the two-dimensional dispatch supported by
// three.js. Collision buckets round up to a power of two, so their 36-byte rows
// can hit the storage limit before the crowd's 16-byte instance buffers do.
export const COLLISION_BUCKET = 8;
export const COMPUTE_WORKGROUP_SIZE = 64;

export function storageByteLimit( limits = {} ) {

	return Math.min( limits.maxStorageBufferBindingSize ?? 134217728, limits.maxBufferSize ?? 268435456 );

}

export function computeCountLimit( limits = {} ) {

	if ( ( limits.maxComputeInvocationsPerWorkgroup ?? 256 ) < COMPUTE_WORKGROUP_SIZE ||
		( limits.maxComputeWorkgroupSizeX ?? 256 ) < COMPUTE_WORKGROUP_SIZE ) return 0;
	const dimension = limits.maxComputeWorkgroupsPerDimension ?? 65535;
	return Math.min( 0xffffffff, dimension * dimension * COMPUTE_WORKGROUP_SIZE );

}

export function collisionTableSize( capacity ) {

	return Math.max( 4096, 2 ** Math.ceil( Math.log2( Math.max( 1, capacity ) ) ) );

}

export function crowdCapacityLimit( limits = {}, { collide = false } = {} ) {

	const bytes = storageByteLimit( limits ), dispatch = computeCountLimit( limits );
	let capacity = Math.min( 4194304, Math.floor( bytes / 16 ), dispatch );
	if ( collide ) {

		const tableLimit = Math.min( Math.floor( bytes / ( ( COLLISION_BUCKET + 1 ) * 4 ) ), dispatch );
		if ( tableLimit < 4096 ) return 0;
		capacity = Math.min( capacity, 2 ** Math.floor( Math.log2( tableLimit ) ) );

	}
	return Math.floor( capacity / COMPUTE_WORKGROUP_SIZE ) * COMPUTE_WORKGROUP_SIZE;

}

export function skeletalCapacity( limits, capacity ) {

	return Math.min( capacity, 131072, Math.floor( storageByteLimit( limits ) / 480 ), computeCountLimit( limits ) );

}
