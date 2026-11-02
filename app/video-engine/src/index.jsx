import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {Intro} from './Intro.jsx';
import project from '../project.json';
const Root=()=> <Composition id="AIPMIntro" component={Intro} fps={30} width={1920} height={1080} durationInFrames={300} defaultProps={project} calculateMetadata={({props})=>({durationInFrames:Math.round(props.duration*props.fps),fps:props.fps,width:props.width,height:props.height})}/>;
registerRoot(Root);
