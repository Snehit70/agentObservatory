<script lang="ts">
	import { page } from '$app/state';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	const isTopRoute = (path: string) => {
		if (path === '/') return page.url.pathname === '/';
		return page.url.pathname === path || page.url.pathname.startsWith(`${path}/`);
	};
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Agent Observatory</title>
	<meta name="description" content="Token usage statistics for OpenCode" />
</svelte:head>

<div>
	<nav class="top-nav">
		<a
			href="/"
			class="top-nav-link {isTopRoute('/') ? 'active' : ''}"
			aria-current={isTopRoute('/') ? 'page' : undefined}>dashboard</a
		>
		<a
			href="/live"
			class="top-nav-link {isTopRoute('/live') ? 'active' : ''}"
			aria-current={isTopRoute('/live') ? 'page' : undefined}>live</a
		>
		<a
			href="/conversations"
			class="top-nav-link {isTopRoute('/conversations') ? 'active' : ''}"
			aria-current={isTopRoute('/conversations') ? 'page' : undefined}>conversations</a
		>
	</nav>

	{@render children()}
</div>
