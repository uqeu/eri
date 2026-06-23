// @pmndrs/assets ships base64 data-URI modules (HDRIs, etc.) with no types.
declare module "@pmndrs/assets/hdri/*" {
  const src: string;
  export default src;
}
