// 16 kHz G.711 mu-law fallback. Frames remain ephemeral in the private room.
class RadioCapture extends AudioWorkletProcessor {
  constructor(){super();this.frame=new Uint8Array(2048);this.index=0;}
  process(inputs){const samples=inputs[0]?.[0];if(!samples)return true;
    for(const sample of samples){let pcm=Math.max(-32635,Math.min(32635,Math.round(sample*32767)));const sign=pcm<0?128:0;pcm=Math.abs(pcm)+132;let exponent=7;for(let mask=16384;exponent>0&&!(pcm&mask);mask>>=1)exponent--;const mantissa=(pcm>>(exponent+3))&15;this.frame[this.index++]=~(sign|(exponent<<4)|mantissa)&255;
      if(this.index===2048){this.port.postMessage(this.frame,this.frame.buffer?[this.frame.buffer]:[]);this.frame=new Uint8Array(2048);this.index=0;}
    }return true;
  }
}
registerProcessor('radio-capture',RadioCapture);
