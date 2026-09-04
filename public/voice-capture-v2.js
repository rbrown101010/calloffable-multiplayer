// 16 kHz G.711 mu-law fallback. Encode only speech needed by peers without direct media.
class RadioCapture extends AudioWorkletProcessor {
  constructor(){
    super();this.samples=new Float32Array(2048);this.index=0;this.power=0;this.hangover=0;this.active=false;
    this.port.onmessage=({data})=>{this.active=!!data.active;this.index=0;this.power=0;this.hangover=0;};
  }
  process(inputs){
    if(!this.active)return true;
    const samples=inputs[0]?.[0];if(!samples)return true;
    for(const sample of samples){
      this.samples[this.index++]=sample;this.power+=sample*sample;
      if(this.index!==2048)continue;
      const speech=Math.sqrt(this.power/2048)>.004;
      if(speech)this.hangover=3;
      if(speech||this.hangover>0){
        if(!speech)this.hangover--;
        const frame=new Uint8Array(2048);
        for(let i=0;i<2048;i++){
          let pcm=Math.max(-32635,Math.min(32635,Math.round(this.samples[i]*32767)));const sign=pcm<0?128:0;pcm=Math.abs(pcm)+132;
          let exponent=7;for(let mask=16384;exponent>0&&!(pcm&mask);mask>>=1)exponent--;
          frame[i]=~(sign|(exponent<<4)|((pcm>>(exponent+3))&15))&255;
        }
        this.port.postMessage({audio:frame,capturedAt:currentTime},[frame.buffer]);
      }
      this.index=0;this.power=0;
    }
    return true;
  }
}
registerProcessor('radio-capture',RadioCapture);
