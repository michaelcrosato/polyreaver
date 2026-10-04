// Only imported by the chosen engine, after platform and device checks pass.
export function mountLayout( html ) {

	const template = document.createElement( 'template' );
	template.innerHTML = html;
	const root = document.createElement( 'div' );
	root.id = 'engine-root';
	root.hidden = true;
	root.append( template.content );
	document.body.append( root );

}
