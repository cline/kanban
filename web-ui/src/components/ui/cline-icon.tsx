export function ClineIcon({ size = 20, className }: { size?: number; className?: string }): React.ReactElement {
	return (
		<svg width={size} height={size} viewBox="0 0 92 95" fill="currentColor" className={className}>
			<path
				d="M65.45 15.8c10.89 0 19.71 8.865 19.71 19.8v6.6l5.74 11.465a4.8 4.8 0 0 1-.007 4.595L85.16 68.6v6.6c0 10.935-8.83 19.8-19.71 19.8H26.02c-10.89 0-19.71-8.865-19.71-19.8v-6.6L.45 57.295a4.8 4.8 0 0 1-.008-3.666L6.31 42.2v-6.6c0-10.935 8.83-19.8 19.71-19.8h39.43ZM30.73 38c-4.97 0-9 4.03-9 9v16c0 4.97 4.03 9 9 9s9-4.03 9-9V47c0-4.97-4.03-9-9-9Zm29 0c-4.97 0-9 4.03-9 9v16c0 4.97 4.03 9 9 9s9-4.03 9-9V47c0-4.97-4.03-9-9-9Z"
				fillRule="nonzero"
			/>
			<circle cx="45.735" cy="11" r="11" />
		</svg>
	);
}
