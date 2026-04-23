export function memoryStore<E>() {
	const events: E[] = [];

	return {
		events,

		write(event: E) {
			events.push(event);
		},

		flush() {
			return Promise.resolve();
		},

		reset() {
			events.length = 0;
		},
	};
}
