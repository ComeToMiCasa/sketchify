import postcss from 'postcss';
import sketchify, { type SketchifyOptions } from '../../src/index';

/** Runs the plugin the way a build would and returns the output CSS. */
export const transform = async (
  css: string,
  options: SketchifyOptions = {},
  from = 'input.css',
): Promise<string> => (await postcss([sketchify(options)]).process(css, { from })).css;
