import sharp from 'sharp';
sharp('data/nft-preview-kr.svg').png().toFile('data/nft-preview-kr.png').then(() => console.log('PNG generated'));
