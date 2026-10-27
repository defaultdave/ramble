import { describeImagePortContract } from '../../../../tests/contracts/image-port';
import { createSharpImageAdapter } from './sharp';

describeImagePortContract('sharp', createSharpImageAdapter);
